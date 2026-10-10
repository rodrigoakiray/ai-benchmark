"""Baixa o pacote de benchmarks da Epoch AI (CC-BY 4.0) e grava 4 tabelas no bronze.

Tabelas: epoch_benchmarks (todos os CSVs de benchmark empilhados, coluna _csv_name),
epoch_eci (Epoch Capabilities Index), epoch_models (model_metadata.csv), epoch_benchmark_meta.
Uso: python tools/ingest_epoch.py [--dt YYYY-MM-DD] [--dry-run]
"""
import argparse
import io
import zipfile

import pandas as pd

import lake

URL = "https://epoch.ai/data/benchmark_data.zip"
SPECIAL = {
    "epoch_capabilities_index/eci_scores.csv": "epoch_eci",
    "model_metadata.csv": "epoch_models",
    "benchmark_metadata.csv": "epoch_benchmark_meta",
}


def run(dt: str, dry_run: bool) -> None:
    z = zipfile.ZipFile(io.BytesIO(lake.get(URL).content))
    names = z.namelist()
    missing = set(SPECIAL) - set(names)
    if missing:
        raise RuntimeError(f"zip da Epoch mudou: faltam {sorted(missing)}")

    def csv(name: str) -> pd.DataFrame:
        return pd.read_csv(io.BytesIO(z.read(name)), dtype=str)

    for name, table in SPECIAL.items():
        lake.write(lake.to_bronze(csv(name), "epoch", f"{URL}#{name}"), "bronze", table, dt, dry_run)

    bench = [n for n in names if n.endswith(".csv") and "/" not in n and n not in SPECIAL]
    df = pd.concat([csv(n).assign(_csv_name=n) for n in bench], ignore_index=True)
    lake.write(lake.to_bronze(df, "epoch", URL), "bronze", "epoch_benchmarks", dt, dry_run)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dt", default=lake.today())
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    run(a.dt, a.dry_run)
