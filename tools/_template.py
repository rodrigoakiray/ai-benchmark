"""<o que esta tool faz, em uma linha>.

Uso: python tools/<nome>.py --layer bronze --table <tabela> [--dry-run]
"""
import argparse
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

load_dotenv()

LAKE = Path("datalake")


def run(layer: str, table: str, domain: str, dry_run: bool) -> pd.DataFrame:
    # 1. ler origem
    df = pd.DataFrame()

    # 2. transformar (bronze: só linhagem; silver: limpeza/tipos; gold: agregação)
    if layer == "bronze":
        df["_source"] = "<fonte>"
        df["_source_file"] = "<arquivo ou endpoint>"
        df["_ingested_at"] = datetime.now(UTC).isoformat()

    # 3. gravar
    out = LAKE / layer / domain / table / f"dt={datetime.now(UTC):%Y-%m-%d}" / "part-0.parquet"
    if dry_run:
        print(f"[dry-run] gravaria {len(df)} linhas em {out}")
    else:
        out.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(out, index=False)
        print(f"gravadas {len(df)} linhas em {out} ({datetime.now(UTC):%H:%M:%S} UTC)")
    return df


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--layer", required=True, choices=["bronze", "silver", "gold"])
    p.add_argument("--table", required=True)
    p.add_argument("--domain", default="llm")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    run(a.layer, a.table, a.domain, a.dry_run)
