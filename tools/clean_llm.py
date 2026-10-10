"""bronze → silver: normaliza nomes de modelo, tipa e grava 3 tabelas do snapshot `dt`.

silver/llm/benchmark_scores  (longa) snapshot_date, model_id, variant, source, benchmark, score, unit, source_model_name
silver/llm/models            snapshot_date, model_id, display_name, organization, release_date, open_weights
silver/llm/prices            snapshot_date, model_id, provider, source, source_model_key, preços USD/1M, batch_status
Nomes não casados entre fontes vão para .tmp/unmatched_<fonte>.csv (para alimentar config/model_aliases.csv).
Uso: python tools/clean_llm.py [--dt YYYY-MM-DD] [--dry-run]
"""
import argparse
import re

import pandas as pd

import lake
from model_ids import canonical, load_aliases, slug, split_variant

# ordem de preferência do preço: primeiro o próprio laboratório, depois hosts de modelos abertos
PROVIDER_PRIORITY = [
    "openai", "anthropic", "gemini", "xai", "deepseek", "mistral", "moonshot", "zai", "minimax",
    "meta_llama", "amazon_nova", "cohere_chat", "ai21", "perplexity", "dashscope",
    "together_ai", "fireworks_ai", "groq", "deepinfra", "cerebras", "sambanova",
]
# criador na Artificial Analysis → provider de config/batch_discounts.csv (preço vindo da AA)
AA_CREATOR_PROVIDER = {"OpenAI": "openai", "Anthropic": "anthropic", "Google": "gemini",
                       "Mistral": "mistral", "Alibaba": "dashscope"}
AA_INDICES = {
    "evaluations.artificial_analysis_intelligence_index": "AA Intelligence Index",
    "evaluations.artificial_analysis_coding_index": "AA Coding Index",
    "evaluations.artificial_analysis_agentic_index": "AA Agentic Index",
}
PER_1M = 1_000_000
# grafias diferentes da mesma organização entre as fontes (chave em minúsculas)
ORGS = {
    "google deepmind": "Google", "google": "Google", "meta ai": "Meta", "meta": "Meta", "openai": "OpenAI",
    "anthropic": "Anthropic", "mistral ai": "Mistral", "mistral": "Mistral", "xai": "xAI", "spacexai": "xAI",
    "z ai": "Z.ai", "z.ai (zhipu ai)": "Z.ai", "zai": "Z.ai", "xiaomi corp": "Xiaomi", "xiaomi": "Xiaomi",
    "nvidia": "NVIDIA", "allen institute for ai": "Ai2", "allenai": "Ai2", "ai21 labs": "AI21", "ai21": "AI21",
    "alibaba": "Alibaba", "deepseek": "DeepSeek", "moonshot": "Moonshot", "amazon": "Amazon", "ibm": "IBM",
    "microsoft": "Microsoft", "cohere": "Cohere", "tencent": "Tencent", "baidu": "Baidu", "stepfun": "StepFun",
    "minimax": "MiniMax", "inclusionai": "InclusionAI",
}


def org(name: object) -> str | None:
    """"Google DeepMind,Google" → "Google"; "tencent" → "Tencent"."""
    if not isinstance(name, str) or not name.strip():
        return None
    first = name.split(",")[0].strip()
    return ORGS.get(first.lower(), first)


def num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce").astype("float64")


def optional(dt: str, table: str) -> pd.DataFrame | None:
    return lake.read("bronze", table, dt) if lake.has_partition("bronze", table, dt) else None


class Resolver:
    """Converte o nome de cada fonte em (model_id, variant), registrando o que veio de cada fonte."""

    def __init__(self, known: set[str]):
        self.known = known
        self.aliases = load_aliases()
        self.seen: dict[str, set[tuple[str, str]]] = {}
        self.external: set[str] = set()  # ids vistos fora da Epoch (AA, LMArena, LiteLLM)

    def _id(self, source: str, name: str) -> tuple[str, str | None]:
        model_id, variant = canonical(name, self.known)
        return self.aliases.get(model_id, model_id), variant

    def __call__(self, source: str, name: str) -> tuple[str, str | None]:
        model_id, variant = self._id(source, name)
        self.seen.setdefault(source, set()).add((name, model_id))
        if source != "epoch":
            self.external.add(model_id)
        return model_id, variant

    def epoch(self, version: str, group: str | None) -> tuple[str, str | None]:
        """A Epoch tem dois nomes por modelo: a versão ("gemini-3-pro-preview_high") e o grupo ("Gemini 3 Pro").
        Fica com o que casa com outra fonte; na dúvida, a versão. Chame depois das outras fontes."""
        model_id, variant = self._id("epoch", version)
        if model_id not in self.external and isinstance(group, str):
            by_group = self._id("epoch", group)[0]
            if by_group in self.external:
                model_id = by_group
        self.seen.setdefault("epoch", set()).add((version, model_id))
        return model_id, variant

    def report_unmatched(self) -> None:
        ids = {s: {m for _, m in pairs} for s, pairs in self.seen.items()}
        out = lake.ROOT / ".tmp"
        out.mkdir(exist_ok=True)
        for source, pairs in self.seen.items():
            others = set().union(*(v for k, v in ids.items() if k != source))
            rows = sorted({(n, m) for n, m in pairs if m not in others})
            pd.DataFrame(rows, columns=["source_name", "model_id"]).to_csv(out / f"unmatched_{source}.csv", index=False)
            print(f"{source}: {len(ids[source])} modelos, {len({m for _, m in rows})} sem par em outra fonte")


def epoch_groups(dt: str) -> pd.DataFrame:
    return lake.read("bronze", "epoch_models", dt).dropna(subset=["model_version"])


def epoch_scores(dt: str, resolve: Resolver) -> pd.DataFrame:
    bench = lake.read("bronze", "epoch_benchmarks", dt)
    meta = lake.read("bronze", "epoch_benchmark_meta", dt).dropna(subset=["source_file", "score_column"])
    em = epoch_groups(dt)
    version_to_group = em.drop_duplicates("model_version").set_index("model_version")["model_group"]
    parts = []
    for m in meta.itertuples():
        rows = bench[bench["_csv_name"] == m.source_file]
        if m.score_column not in rows.columns:
            raise RuntimeError(f"Epoch: coluna '{m.score_column}' sumiu de {m.source_file}")
        rows = rows.dropna(subset=["Model version"])
        parts.append(pd.DataFrame({
            "source_model_name": rows["Model version"],
            "benchmark": m.benchmark,
            "score": num(rows[m.score_column]) * float(m.scale),
            "unit": "fraction",
        }))
    # o ECI usa o nome do grupo ("Qwen 3.8 Max"); converte para a versão ("qwen3.8-max_max") como nos CSVs
    group_to_version = em.dropna(subset=["model_group"]).drop_duplicates("model_group")
    group_to_version = group_to_version.set_index("model_group")["model_version"]
    eci = lake.read("bronze", "epoch_eci", dt)
    parts.append(pd.DataFrame({"source_model_name": eci["Model"].map(group_to_version).fillna(eci["Model"]),
                               "benchmark": "ECI", "score": num(eci["eci"]), "unit": "index"}))
    df = pd.concat(parts, ignore_index=True)
    df[["model_id", "variant"]] = [resolve.epoch(n, version_to_group.get(n)) for n in df["source_model_name"]]
    return df.assign(source="epoch")


def lmarena_scores(dt: str, resolve: Resolver) -> pd.DataFrame:
    lm = lake.read("bronze", "lmarena_text", dt)
    lm = lm[lm["category"] == "overall"]
    df = pd.DataFrame({"source_model_name": lm["model_name"], "benchmark": "Arena Elo (texto)",
                       "score": num(lm["rating"]), "unit": "elo"})
    df[["model_id", "variant"]] = [resolve("lmarena", n) for n in df["source_model_name"]]
    return df.assign(source="lmarena")


def aa_scores(aa: pd.DataFrame, resolve: Resolver) -> pd.DataFrame:
    parts = [pd.DataFrame({"source_model_name": aa["slug"], "benchmark": label, "score": num(aa[col]),
                           "unit": "index"}) for col, label in AA_INDICES.items() if col in aa.columns]
    df = pd.concat(parts, ignore_index=True)
    df[["model_id", "variant"]] = [resolve("artificial_analysis", n) for n in df["source_model_name"]]
    return df.assign(source="artificial_analysis")


def litellm_candidates(dt: str, resolve: Resolver) -> pd.DataFrame:
    p = lake.read("bronze", "litellm_prices", dt)
    p = p[p["litellm_provider"].isin(PROVIDER_PRIORITY)].copy()
    ids = [resolve("litellm", k) for k in p["model_key"]]
    p["model_id"] = [i for i, _ in ids]
    p = p[[v is None for _, v in ids]]  # "-thinking"/"-high" no LiteLLM são aliases do mesmo preço

    def col(c: str) -> pd.Series:
        return num(p[c]) * PER_1M if c in p.columns else pd.Series(float("nan"), index=p.index)

    out = pd.DataFrame({
        "model_id": p["model_id"], "provider": p["litellm_provider"], "source": "litellm",
        "source_model_key": p["model_key"],
        "input_usd_1m": col("input_cost_per_token"), "output_usd_1m": col("output_cost_per_token"),
        "cached_input_usd_1m": col("cache_read_input_token_cost"),
        "batch_input_usd_1m": col("input_cost_per_token_batches"),
        "batch_output_usd_1m": col("output_cost_per_token_batches"),
    })
    out["priority"] = out["provider"].map({p: i for i, p in enumerate(PROVIDER_PRIORITY)})
    out["dated"] = out["source_model_key"].str.contains(r"\d{4}-?\d{2}-?\d{2}$", regex=True)
    out["key_len"] = out["source_model_key"].str.len()
    return out


def aa_candidates(aa: pd.DataFrame, resolve: Resolver) -> pd.DataFrame:
    ids = [resolve("artificial_analysis", s) for s in aa["slug"]]
    out = pd.DataFrame({
        "model_id": [i for i, _ in ids],
        "provider": aa["model_creator.name"].map(AA_CREATOR_PROVIDER).fillna(aa["model_creator.name"].str.lower()),
        "source": "artificial_analysis", "source_model_key": aa["slug"],
        "input_usd_1m": num(aa["pricing.price_1m_input_tokens"]),
        "output_usd_1m": num(aa["pricing.price_1m_output_tokens"]),
        "cached_input_usd_1m": num(aa.get("pricing.price_1m_cache_hit_tokens", pd.Series(dtype="str"))),
        "batch_input_usd_1m": float("nan"), "batch_output_usd_1m": float("nan"),
    })
    out = out[(out["input_usd_1m"] > 0) | (out["output_usd_1m"] > 0)]
    out["priority"], out["dated"], out["key_len"] = len(PROVIDER_PRIORITY), False, out["source_model_key"].str.len()
    return out


def select_prices(cands: pd.DataFrame, discounts: pd.DataFrame) -> pd.DataFrame:
    """Um preço por modelo: provider de maior prioridade, chave sem data, chave mais curta.
    Batch: oficial se a fonte publica; senão fator de config/batch_discounts.csv (estimated); senão unavailable."""
    best = (cands.dropna(subset=["input_usd_1m", "output_usd_1m"])
            .sort_values(["model_id", "priority", "dated", "key_len"])
            .drop_duplicates("model_id").drop(columns=["priority", "dated", "key_len"]))
    official = best["batch_input_usd_1m"].notna() & best["batch_output_usd_1m"].notna()
    factor = best["provider"].map(discounts.set_index("provider")["batch_factor"])
    estimated = ~official & factor.notna()
    best.loc[estimated, "batch_input_usd_1m"] = best["input_usd_1m"] * factor
    best.loc[estimated, "batch_output_usd_1m"] = best["output_usd_1m"] * factor
    best["batch_status"] = "unavailable"
    best.loc[official, "batch_status"] = "official"
    best.loc[estimated, "batch_status"] = "estimated"
    return best.reset_index(drop=True)


def strip_effort(name: str) -> str:
    """"Claude Opus 5.5 (Max, Default Fallback)" → "Claude Opus 5.5"."""
    return re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()


def model_dim(dt: str, aa: pd.DataFrame | None, resolve: Resolver) -> pd.DataFrame:
    """Uma linha por model_id com nome, organização, lançamento e open weights (Epoch > AA > LMArena)."""
    em = epoch_groups(dt)
    access = em["accessibility"].fillna("")
    epoch = pd.DataFrame({
        "model_id": [resolve.epoch(v, g)[0] for v, g in zip(em["model_version"], em["model_group"], strict=True)],
        "display_name": em["model_group"], "organization": em["organization"],
        "release_date": em["date"],
        "open_weights": access.str.startswith("Open weights").where(access != "", None),
        "rank": 0,
    })
    parts = [epoch]
    if aa is not None:
        aa = aa[~aa["slug"].str.contains(r"-(?:xhigh|high|medium|low|minimal)$", regex=True)]
        parts.append(pd.DataFrame({
            "model_id": [resolve("artificial_analysis", s)[0] for s in aa["slug"]],
            "display_name": aa["name"].map(strip_effort), "organization": aa["model_creator.name"],
            "release_date": aa["release_date"], "open_weights": None, "rank": 1,
        }))
    lm = lake.read("bronze", "lmarena_text", dt)
    lm = lm[lm["category"] == "overall"]
    parts.append(pd.DataFrame({
        "model_id": [resolve("lmarena", n)[0] for n in lm["model_name"]],
        "display_name": lm["model_name"], "organization": lm["organization"], "release_date": None,
        "open_weights": lm["license"].fillna("") != "Proprietary", "rank": 2,
    }))
    allm = pd.concat(parts, ignore_index=True).sort_values(["model_id", "rank"])
    allm["organization"] = allm["organization"].map(org)
    # primeiro valor não nulo de cada coluna, na ordem de prioridade das fontes
    dim = allm.groupby("model_id", sort=True).agg({c: "first" for c in
                                                   ["display_name", "organization", "release_date", "open_weights"]})
    dim = dim.reset_index()
    dim["display_name"] = dim["display_name"].fillna(dim["model_id"]).astype("str")
    dim["organization"] = dim["organization"].astype("str")
    dim["release_date"] = pd.to_datetime(dim["release_date"], errors="coerce")
    dim["open_weights"] = dim["open_weights"].astype("boolean")
    return dim


def run(dt: str, dry_run: bool) -> None:
    aa = optional(dt, "aa_models")
    discounts = pd.read_csv(lake.ROOT / "config" / "batch_discounts.csv")
    lit = lake.read("bronze", "litellm_prices", dt)
    em = lake.read("bronze", "epoch_models", dt)
    known = {split_variant(v)[0] for v in em["model_version"].dropna()}
    known |= {slug(k) for k in lit["model_key"]}
    if aa is not None:
        known |= {slug(s) for s in aa["slug"]}  # a AA lista o modelo base sem sufixo além das variantes
    resolve = Resolver(known)

    # fontes externas primeiro: a Epoch escolhe entre versão e grupo conforme o que já foi visto nelas
    scores = [lmarena_scores(dt, resolve)]
    cands = [litellm_candidates(dt, resolve)]
    if aa is not None:
        scores.append(aa_scores(aa, resolve))
        cands.append(aa_candidates(aa, resolve))
    scores.append(epoch_scores(dt, resolve))
    snapshot = pd.Timestamp(dt)

    s = pd.concat(scores, ignore_index=True).dropna(subset=["score"])
    s = s.assign(snapshot_date=snapshot).astype({c: "str" for c in
                                                  ["model_id", "variant", "source", "benchmark", "unit",
                                                   "source_model_name"]})
    s = s[["snapshot_date", "model_id", "variant", "source", "benchmark", "score", "unit", "source_model_name"]]
    lake.write(s.drop_duplicates().reset_index(drop=True), "silver", "benchmark_scores", dt, dry_run)

    lake.write(model_dim(dt, aa, resolve).assign(snapshot_date=snapshot), "silver", "models", dt, dry_run)

    prices = select_prices(pd.concat(cands, ignore_index=True), discounts).assign(snapshot_date=snapshot)
    prices = prices.astype({c: "str" for c in ["model_id", "provider", "source", "source_model_key", "batch_status"]})
    lake.write(prices, "silver", "prices", dt, dry_run)

    resolve.report_unmatched()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dt", default=lake.today())
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    run(a.dt, a.dry_run)
