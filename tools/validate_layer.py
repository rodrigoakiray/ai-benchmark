"""Valida uma tabela do datalake: existe, não está vazia, cumpre regras mínimas da camada.

Uso: python tools/validate_layer.py --layer silver --table <tabela> [--domain <dominio>]
Sai com código 1 se alguma checagem falhar.
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

LINEAGE = {"_source", "_source_file", "_ingested_at"}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--layer", required=True, choices=["bronze", "silver", "gold"])
    p.add_argument("--table", required=True)
    p.add_argument("--domain", default="llm")
    a = p.parse_args()

    root = Path("datalake") / a.layer / a.domain / a.table
    files = sorted(root.rglob("*.parquet"))
    errors: list[str] = []

    if not files:
        errors.append(f"nenhum parquet em {root}")
    else:
        df = pd.concat(pd.read_parquet(f) for f in files)
        if df.empty:
            errors.append("tabela vazia")
        if a.layer == "bronze" and not LINEAGE.issubset(df.columns):
            errors.append(f"bronze sem colunas de linhagem {sorted(LINEAGE - set(df.columns))}")
        if a.layer in ("silver", "gold"):
            if df.duplicated().any():
                errors.append(f"{int(df.duplicated().sum())} linhas duplicadas")
            if any(str(t) == "object" for t in df.dtypes) and a.layer == "silver":
                errors.append("silver com colunas 'object' — defina tipos explícitos")

    if errors:
        print(f"FALHOU {a.layer}/{a.domain}/{a.table}:", *errors, sep="\n  - ")
        return 1
    print(f"OK {a.layer}/{a.domain}/{a.table}: {len(files)} arquivo(s), {len(df)} linhas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
