"""Baixa a tabela de preços do LiteLLM (MIT), fixada no último commit, e grava os modelos de texto no bronze.

Preços em USD por token, incluindo os campos *_batches (Batch API) quando o provider publica.
Uso: python tools/ingest_litellm.py [--dt YYYY-MM-DD] [--dry-run]
"""
import argparse
import json
import os

import pandas as pd

import lake

REPO = "BerriAI/litellm"
FILE = "model_prices_and_context_window.json"
MODES = {"chat", "responses"}  # "responses": modelos só da Responses API (ex.: gpt-5.5-pro)


def to_frame(data: dict) -> pd.DataFrame:
    rows = []
    for key, spec in data.items():
        if key == "sample_spec" or not isinstance(spec, dict) or spec.get("mode") not in MODES:
            continue
        row = {k: json.dumps(v) if isinstance(v, (dict, list)) else v for k, v in spec.items()}
        rows.append({"model_key": key, **row})
    return pd.DataFrame(rows)


def run(dt: str, dry_run: bool) -> None:
    # no Actions, GITHUB_TOKEN evita o limite de 60 req/h por IP da API anônima
    gh = {"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}"} if os.environ.get("GITHUB_TOKEN") else {}
    commits = lake.get(
        f"https://api.github.com/repos/{REPO}/commits", headers=gh, params={"path": FILE, "per_page": 1}
    ).json()
    sha = commits[0]["sha"]
    url = f"https://raw.githubusercontent.com/{REPO}/{sha}/{FILE}"
    df = to_frame(lake.get(url).json())
    if "input_cost_per_token" not in df.columns or "litellm_provider" not in df.columns:
        raise RuntimeError("schema do LiteLLM mudou: faltam input_cost_per_token/litellm_provider")
    lake.write(lake.to_bronze(df, "litellm", url), "bronze", "litellm_prices", dt, dry_run)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dt", default=lake.today())
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    run(a.dt, a.dry_run)
