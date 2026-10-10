"""silver → gold: tabela única gold/llm/model_scorecard (uma linha por snapshot × modelo, todo o histórico).

Junta capacidade (índices e benchmarks, melhor variante de esforço), dimensão do modelo e preço padrão/batch.
Calcula preço blended 3:1 (input:output), custo-benefício, ranking, fronteira de Pareto (capacidade × preço)
e um índice 0-100 por aplicação (programação, agentes, pesquisa...) definido em config/applications.json.
Uso: python tools/build_scorecard.py [--dry-run]
"""
import argparse
import json

import pandas as pd

import lake

CONFIG = json.loads((lake.ROOT / "config" / "applications.json").read_text(encoding="utf-8"))
BENCHMARKS: dict[str, dict] = CONFIG["benchmarks"]  # coluna do gold → {source, benchmark, label, description}
APPLICATIONS: list[dict] = CONFIG["applications"]
CAPABILITY = ["aa_intelligence_index", "eci", "arena_elo"]  # em ordem de preferência para a métrica principal
PRICE_COLS = ["provider", "source", "input_usd_1m", "output_usd_1m", "cached_input_usd_1m",
              "batch_input_usd_1m", "batch_output_usd_1m", "batch_status"]


def blended(inp: pd.Series, out: pd.Series) -> pd.Series:
    """Preço médio por 1M tokens supondo 3 tokens de entrada para 1 de saída (convenção da Artificial Analysis)."""
    return (3 * inp + out) / 4


def pareto(score: pd.Series, price: pd.Series) -> pd.Series:
    """True quando nenhum outro modelo é ao mesmo tempo mais barato (ou igual) e melhor (ou igual)."""
    ok = score.notna() & price.notna() & (price > 0)
    order = pd.DataFrame({"s": score[ok], "p": price[ok]}).sort_values(["p", "s"], ascending=[True, False])
    best, front = float("-inf"), set()
    for idx, row in order.iterrows():
        if row.s > best:
            front.add(idx)
            best = row.s
    return pd.Series(score.index.isin(list(front)), index=score.index)


def normalize(values: pd.Series, unit: str, baseline: float) -> pd.Series:
    """Nota relativa ao melhor modelo do snapshot, de 0 (acaso/pior) a 1 (líder).
    fraction: (nota - acerto aleatório) / (melhor - acerto aleatório); index: nota / melhor;
    elo: 2 × chance de vencer o líder (o líder vale 1; 100 pontos abaixo ≈ 0,72)."""
    best = values.max()
    if unit == "elo":
        return 2 / (1 + 10 ** ((best - values) / 400))
    floor = baseline if unit == "fraction" else 0.0
    if not best > floor:
        return values * float("nan")
    return ((values - floor) / (best - floor)).clip(0, 1)


def application_scores(raw: pd.DataFrame, units: dict[str, str], baselines: dict[str, float],
                       applications: list[dict] = APPLICATIONS) -> pd.DataFrame:
    """Índice 0-100 de cada aplicação = média das notas normalizadas dos benchmarks que o modelo tem.
    Exige 2 benchmarks da aplicação, para um único teste não decidir, e `min_objective` (padrão 1) testes
    objetivos: o LMArena mede preferência de pessoas, que sozinha não comprova a capacidade."""
    norm = pd.DataFrame({c: normalize(raw[c], units[c], baselines[c]) for c in raw.columns}, index=raw.index)
    out = {}
    for app in applications:
        cols = [c for c in app["benchmarks"] if c in norm.columns]
        objective = [c for c in cols if units[c] != "elo"]
        n = norm[cols].notna().sum(axis=1)
        n_obj = norm[objective].notna().sum(axis=1)
        ok = (n >= min(2, len(cols))) & (n_obj >= app.get("min_objective", 1))
        out[f"app_{app['id']}"] = (norm[cols].mean(axis=1) * 100).where(ok).round(1)
        out[f"app_{app['id']}_n"] = n.astype("int64")
    return pd.DataFrame(out, index=raw.index)


def build_snapshot(scores: pd.DataFrame, models: pd.DataFrame, prices: pd.DataFrame) -> pd.DataFrame:
    by_label = {(b["source"], b["benchmark"]): col for col, b in BENCHMARKS.items()}
    s = scores.assign(column=[by_label.get(k) for k in zip(scores["source"], scores["benchmark"], strict=True)])
    s = s.dropna(subset=["column"])
    raw = s.pivot_table(index="model_id", columns="column", values="score", aggfunc="max")
    raw = raw.reindex(columns=list(BENCHMARKS))
    units = s.drop_duplicates("column").set_index("column")["unit"].reindex(raw.columns).fillna("index").to_dict()
    baselines = s.groupby("column")["baseline"].first().reindex(raw.columns).fillna(0.0).to_dict()
    raw = raw[raw[CAPABILITY].notna().any(axis=1)]
    sources = scores.groupby("model_id")["source"].agg(lambda x: ",".join(sorted(set(x))))

    df = (raw.join(application_scores(raw, units, baselines))
          .join(models.set_index("model_id")[["display_name", "organization", "release_date", "open_weights"]])
          .join(prices.set_index("model_id")[PRICE_COLS].rename(columns={"source": "price_source"}))
          .join(sources.rename("sources")))
    df["blended_usd_1m"] = blended(df["input_usd_1m"], df["output_usd_1m"])
    df["blended_batch_usd_1m"] = blended(df["batch_input_usd_1m"], df["batch_output_usd_1m"])
    df["batch_discount_pct"] = (1 - df["blended_batch_usd_1m"] / df["blended_usd_1m"]) * 100

    metric = next(c for c in CAPABILITY if df[c].notna().any())
    df["primary_metric"] = metric
    df["primary_score"] = df[metric]
    df["capability_rank"] = df["primary_score"].rank(ascending=False, method="min").astype("Int64")
    df["cost_benefit"] = df["primary_score"] / df["blended_usd_1m"]
    df["cost_benefit_batch"] = df["primary_score"] / df["blended_batch_usd_1m"]
    df["is_pareto"] = pareto(df["primary_score"], df["blended_usd_1m"])
    df["is_pareto_batch"] = pareto(df["primary_score"], df["blended_batch_usd_1m"])
    df["display_name"] = df["display_name"].fillna(pd.Series(df.index, index=df.index))
    return df.rename_axis("model_id").reset_index()


def run(dry_run: bool) -> pd.DataFrame:
    scores, models, prices = (lake.read("silver", t) for t in ("benchmark_scores", "models", "prices"))
    parts = []
    for snap in sorted(scores["snapshot_date"].unique()):
        snap_df = build_snapshot(scores[scores["snapshot_date"] == snap], models[models["snapshot_date"] == snap],
                                 prices[prices["snapshot_date"] == snap])
        parts.append(snap_df.assign(snapshot_date=snap))
    gold = pd.concat(parts, ignore_index=True)
    first = ["snapshot_date", "model_id", "display_name", "organization", "release_date", "open_weights"]
    gold = gold[first + [c for c in gold.columns if c not in first]]
    gold = gold.astype({c: "str" for c in ["model_id", "display_name", "organization", "provider", "price_source",
                                           "batch_status", "sources", "primary_metric"]})
    lake.write(gold, "gold", "model_scorecard", None, dry_run)
    return gold


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true")
    run(p.parse_args().dry_run)
