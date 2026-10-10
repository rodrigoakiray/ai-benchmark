"""silver → gold: tabela única gold/llm/model_scorecard (uma linha por snapshot × modelo, todo o histórico).

Junta capacidade (índices e benchmarks, melhor variante de esforço), dimensão do modelo e preço padrão/batch.
Calcula preço blended 3:1 (input:output), custo-benefício, ranking e fronteira de Pareto (capacidade × preço).
Uso: python tools/build_scorecard.py [--dry-run]
"""
import argparse

import pandas as pd

import lake

# benchmark do silver → coluna do gold. Os da Epoch foram escolhidos por cobertura entre os modelos de ponta.
BENCH_COLS = {
    "AA Intelligence Index": "aa_intelligence_index",
    "AA Coding Index": "aa_coding_index",
    "AA Agentic Index": "aa_agentic_index",
    "ECI": "eci",
    "Arena Elo (texto)": "arena_elo",
    "GPQA diamond": "gpqa_diamond",
    "OTIS Mock AIME 2024-2025": "otis_aime",
    "FrontierMath-Tiers-1-3-v2-Private": "frontiermath_t1_3",
    "FrontierMath-Tier-4-v2-Private": "frontiermath_t4",
    "SimpleQA Verified": "simpleqa_verified",
    "ARC-AGI-2": "arc_agi_2",
    "APEX-Agents": "apex_agents",
    "WeirdML": "weirdml",
}
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


def build_snapshot(scores: pd.DataFrame, models: pd.DataFrame, prices: pd.DataFrame) -> pd.DataFrame:
    s = scores[scores["benchmark"].isin(BENCH_COLS)]
    wide = s.pivot_table(index="model_id", columns="benchmark", values="score", aggfunc="max")
    wide = wide.rename(columns=BENCH_COLS).reindex(columns=list(BENCH_COLS.values()))
    wide = wide[wide[CAPABILITY].notna().any(axis=1)]
    sources = scores.groupby("model_id")["source"].agg(lambda x: ",".join(sorted(set(x))))

    df = (wide.join(models.set_index("model_id")[["display_name", "organization", "release_date", "open_weights"]])
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
    return df.reset_index()


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
