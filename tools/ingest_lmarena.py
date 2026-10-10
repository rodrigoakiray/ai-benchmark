"""Baixa o leaderboard de texto do LMArena (Hugging Face, CC-BY 4.0) e grava no bronze (lmarena_text).

Uso: python tools/ingest_lmarena.py [--dt YYYY-MM-DD] [--dry-run]
"""
import argparse
import io

import pandas as pd

import lake

URL = (
    "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main/"
    "text/latest-00000-of-00001.parquet"
)
EXPECTED = {"model_name", "organization", "license", "rating", "vote_count", "rank", "category"}


def run(dt: str, dry_run: bool) -> None:
    df = pd.read_parquet(io.BytesIO(lake.get(URL).content))
    missing = EXPECTED - set(df.columns)
    if missing:
        raise RuntimeError(f"schema do LMArena mudou: faltam {sorted(missing)}")
    lake.write(lake.to_bronze(df, "lmarena", URL), "bronze", "lmarena_text", dt, dry_run)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dt", default=lake.today())
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    run(a.dt, a.dry_run)
