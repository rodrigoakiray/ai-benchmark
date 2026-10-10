"""Baixa os modelos de linguagem da API gratuita da Artificial Analysis e grava no bronze (aa_models).

Atribuição obrigatória: https://artificialanalysis.ai/. Limite do plano free: 100 requisições/dia
(1 por página; hoje são poucas páginas). Sem ARTIFICIAL_ANALYSIS_API_KEY no ambiente, avisa e sai sem erro.
Uso: python tools/ingest_artificial_analysis.py [--dt YYYY-MM-DD] [--dry-run]
"""
import argparse
import os

import pandas as pd
from dotenv import load_dotenv

import lake

URL = "https://artificialanalysis.ai/api/v2/language/models/free"
MAX_PAGES = 20


def to_frame(pages: list[dict]) -> pd.DataFrame:
    records = [m for page in pages for m in page["data"]]
    return pd.json_normalize(records)


def run(dt: str, dry_run: bool) -> None:
    load_dotenv(lake.ROOT / ".env")
    key = os.environ.get("ARTIFICIAL_ANALYSIS_API_KEY")
    if not key:
        print("AVISO: ARTIFICIAL_ANALYSIS_API_KEY ausente — ingestão da Artificial Analysis pulada")
        return
    pages = []
    for page in range(1, MAX_PAGES + 1):
        body = lake.get(URL, headers={"x-api-key": key}, params={"page": page}).json()
        pages.append(body)
        if not body.get("pagination", {}).get("has_more"):
            break
    df = to_frame(pages)
    if "slug" not in df.columns:
        raise RuntimeError("schema da Artificial Analysis mudou: falta 'slug'")
    lake.write(lake.to_bronze(df, "artificial_analysis", URL), "bronze", "aa_models", dt, dry_run)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dt", default=lake.today())
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    run(a.dt, a.dry_run)
