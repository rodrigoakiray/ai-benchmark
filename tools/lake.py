"""Funções comuns de leitura e escrita no datalake (usadas pelas tools de ingestão, limpeza e build)."""
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
LAKE = ROOT / "datalake"
DOMAIN = "llm"
HTTP_HEADERS = {"User-Agent": "bench-ai-model (+https://github.com/rodrigoakiray/ai-benchmark)"}


def today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


def table_dir(layer: str, table: str) -> Path:
    return LAKE / layer / DOMAIN / table


def write(df: pd.DataFrame, layer: str, table: str, dt: str | None, dry_run: bool = False) -> Path:
    """Grava a partição dt=<dt> (ou a tabela inteira, se dt=None), sobrescrevendo o que existir."""
    base = table_dir(layer, table)
    out = (base / f"dt={dt}" if dt else base) / ("part-0.parquet" if dt else f"{table}.parquet")
    if dry_run:
        print(f"[dry-run] gravaria {len(df)} linhas em {out.relative_to(ROOT)}")
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    print(f"gravadas {len(df)} linhas em {out.relative_to(ROOT)} ({datetime.now(UTC):%H:%M:%S} UTC)")
    return out


def read(layer: str, table: str, dt: str | None = None) -> pd.DataFrame:
    """Lê uma partição (dt) ou todas as partições da tabela."""
    base = table_dir(layer, table)
    files = [base / f"dt={dt}" / "part-0.parquet"] if dt else sorted(base.rglob("*.parquet"))
    files = [f for f in files if f.exists()]
    if not files:
        raise FileNotFoundError(f"nenhum parquet para {layer}/{DOMAIN}/{table}" + (f" dt={dt}" if dt else ""))
    return pd.concat((pd.read_parquet(f) for f in files), ignore_index=True)


def has_partition(layer: str, table: str, dt: str) -> bool:
    return (table_dir(layer, table) / f"dt={dt}" / "part-0.parquet").exists()


def to_bronze(df: pd.DataFrame, source: str, source_file: str) -> pd.DataFrame:
    """Bronze é fiel à fonte: todas as colunas como texto, mais as colunas de linhagem."""
    df = df.astype("str")  # nulos continuam nulos (pandas 3)
    df["_source"] = source
    df["_source_file"] = source_file
    df["_ingested_at"] = datetime.now(UTC).isoformat(timespec="seconds")
    return df


def get(url: str, **kwargs) -> requests.Response:
    r = requests.get(url, headers={**HTTP_HEADERS, **kwargs.pop("headers", {})}, timeout=120, **kwargs)
    r.raise_for_status()
    return r
