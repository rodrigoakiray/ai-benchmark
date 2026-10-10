"""gold → site/data: exporta o model_scorecard em JSON para o dashboard (site/index.html).

site/data/scorecard.json  {"models": [...snapshot mais recente...], "history": [...série semanal resumida...]}
site/data/meta.json       data do snapshot, contagens, benchmarks, aplicações, fontes e atribuições
Uso: python tools/export_site.py [--dry-run]
"""
import argparse
import json
from datetime import UTC, datetime

import pandas as pd

import lake
from build_scorecard import APPLICATIONS, BENCHMARKS

OUT = lake.ROOT / "site" / "data"
SOURCES = [
    {"name": "Artificial Analysis", "url": "https://artificialanalysis.ai/",
     "license": "API gratuita, atribuição obrigatória",
     "provides": "Índices geral, de programação, de agentes e por área profissional; preços padrão"},
    {"name": "Epoch AI", "url": "https://epoch.ai/benchmarks", "license": "CC-BY 4.0",
     "provides": "Benchmarks, Epoch Capabilities Index (ECI), datas e acesso aos pesos"},
    {"name": "LMArena", "url": "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset", "license": "CC-BY 4.0",
     "provides": "Elo por categoria (texto) e das arenas de código web, busca e visão"},
    {"name": "LiteLLM", "url": "https://github.com/BerriAI/litellm", "license": "MIT",
     "provides": "Preços padrão e Batch API por provider"},
]
HISTORY_COLS = ["snapshot_date", "model_id", "primary_score", "blended_usd_1m", "blended_batch_usd_1m"]


def records(df: pd.DataFrame) -> list[dict]:
    df = df.copy()
    for c in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[c]):
            df[c] = df[c].dt.strftime("%Y-%m-%d")
        elif pd.api.types.is_float_dtype(df[c]):
            df[c] = df[c].round(4)  # o JSON fica bem menor; o gold mantém a precisão total
    return json.loads(df.to_json(orient="records"))


def run(dry_run: bool) -> None:
    gold = lake.read("gold", "model_scorecard")
    snap = gold["snapshot_date"].max()
    latest = gold[gold["snapshot_date"] == snap].sort_values("capability_rank")
    scorecard = {"models": records(latest.drop(columns=["snapshot_date"])),
                 "history": records(gold[HISTORY_COLS])}
    discounts = pd.read_csv(lake.ROOT / "config" / "batch_discounts.csv")
    meta = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "snapshot_date": snap.strftime("%Y-%m-%d"),
        "snapshots": sorted(d.strftime("%Y-%m-%d") for d in gold["snapshot_date"].unique()),
        "primary_metric": latest["primary_metric"].iloc[0],
        "counts": {"models": len(latest), "with_price": int(latest["blended_usd_1m"].notna().sum()),
                   "batch": latest["batch_status"].value_counts().to_dict()},
        "benchmarks": {col: {k: b[k] for k in ("label", "description", "source")} | {
            "models": int(latest[col].notna().sum())} for col, b in BENCHMARKS.items()},
        "applications": [{**app, "models": int(latest[f"app_{app['id']}"].notna().sum())} for app in APPLICATIONS],
        "sources": SOURCES,
        "batch_discounts": records(discounts),
    }
    if dry_run:
        print(f"[dry-run] exportaria {len(latest)} modelos do snapshot {meta['snapshot_date']} para {OUT}")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "scorecard.json").write_text(json.dumps(scorecard, ensure_ascii=False), encoding="utf-8")
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"exportados {len(latest)} modelos (snapshot {meta['snapshot_date']}) em {OUT.relative_to(lake.ROOT)}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true")
    run(p.parse_args().dry_run)
