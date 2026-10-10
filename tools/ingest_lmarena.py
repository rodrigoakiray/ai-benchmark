"""Baixa os leaderboards do LMArena (Hugging Face, CC-BY 4.0) e grava no bronze, uma tabela por arena.

Arenas: text (conversa, com categorias como coding, math, creative_writing), webdev (Code Arena),
search (respostas com busca na web) e vision (imagens) → bronze/llm/lmarena_<arena>.
Uso: python tools/ingest_lmarena.py [--dt YYYY-MM-DD] [--dry-run]
"""
import argparse
import io

import pandas as pd

import lake

BASE = "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main"
ARENAS = ["text", "webdev", "search", "vision"]
EXPECTED = {"model_name", "organization", "license", "rating", "vote_count", "rank", "category"}


def run(dt: str, dry_run: bool) -> None:
    for arena in ARENAS:
        url = f"{BASE}/{arena}/latest-00000-of-00001.parquet"
        df = pd.read_parquet(io.BytesIO(lake.get(url).content))
        missing = EXPECTED - set(df.columns)
        if missing:
            raise RuntimeError(f"schema do LMArena ({arena}) mudou: faltam {sorted(missing)}")
        lake.write(lake.to_bronze(df, "lmarena", url), "bronze", f"lmarena_{arena}", dt, dry_run)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dt", default=lake.today())
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    run(a.dt, a.dry_run)
