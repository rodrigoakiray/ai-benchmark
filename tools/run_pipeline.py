"""Roda o pipeline inteiro na ordem, validando cada camada. Para no primeiro erro.

ingest (bronze) → validate → clean_llm (silver) → validate → build_scorecard (gold) → validate → export_site
É o mesmo comando no local e no GitHub Actions.
Uso: python tools/run_pipeline.py [--dt YYYY-MM-DD] [--skip-ingest]
"""
import argparse
import subprocess
import sys

import lake

INGEST = ["ingest_epoch.py", "ingest_lmarena.py", "ingest_litellm.py", "ingest_artificial_analysis.py"]
BRONZE = ["epoch_benchmarks", "epoch_eci", "epoch_models", "epoch_benchmark_meta", "lmarena_text", "litellm_prices"]
SILVER = ["benchmark_scores", "models", "prices"]


def step(script: str, *args: str) -> None:
    print(f"\n$ python tools/{script} {' '.join(args)}", flush=True)
    subprocess.run([sys.executable, str(lake.ROOT / "tools" / script), *args], cwd=lake.ROOT, check=True)


def validate(layer: str, tables: list[str]) -> None:
    for t in tables:
        step("validate_layer.py", "--layer", layer, "--table", t)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dt", default=lake.today())
    p.add_argument("--skip-ingest", action="store_true", help="reprocessa a partição bronze já existente de --dt")
    a = p.parse_args()
    try:
        if not a.skip_ingest:
            for script in INGEST:
                step(script, "--dt", a.dt)
        validate("bronze", BRONZE + (["aa_models"] if lake.has_partition("bronze", "aa_models", a.dt) else []))
        step("clean_llm.py", "--dt", a.dt)
        validate("silver", SILVER)
        step("build_scorecard.py")
        validate("gold", ["model_scorecard"])
        step("export_site.py")
    except subprocess.CalledProcessError as e:
        print(f"\nPIPELINE FALHOU em: {' '.join(e.cmd[1:])}", file=sys.stderr)
        return 1
    print(f"\nPIPELINE OK (snapshot {a.dt})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
