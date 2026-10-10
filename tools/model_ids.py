"""Normalização de nomes de modelo para um model_id canônico comum a todas as fontes.

Ex.: "anthropic/claude-opus-5.5-high", "claude-opus-5-5_max" e "Claude Opus 5.5" → "claude-opus-5-5".
Correções manuais ficam em config/model_aliases.csv (alias, model_id): o id gerado aqui → o id canônico.
"""
import csv
import re
from pathlib import Path

ALIASES_FILE = Path(__file__).resolve().parent.parent / "config" / "model_aliases.csv"

# sufixos de esforço/raciocínio que viram "variant" em vez de fazer parte do nome
EFFORTS = {"minimal", "low", "medium", "high", "xhigh", "max", "none", "unknown", "thinking", "reasoning", "adaptive"}
DATE_SUFFIX = re.compile(r"-(\d{8}|\d{4}-\d{2}-\d{2})$")  # -20250514, -2024-08-06


def slug(name: str) -> str:
    s = name.strip().lower().rsplit("/", 1)[-1]  # tira prefixo de provider: "gemini/x", "together_ai/org/x"
    s = re.sub(r"(\d)p(\d)", r"\1-\2", s)  # estilo Fireworks: "glm-5p3" = "glm-5.3"
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    s = re.sub(r"^claude-(\d+(?:-\d)?)-(opus|sonnet|haiku)\b", r"claude-\2-\1", s)  # "claude-4-1-opus" (AA)
    s = DATE_SUFFIX.sub("", s)
    return re.sub(r"-latest$", "", s)


def split_variant(name: str) -> tuple[str, str | None]:
    """Separa sufixos de esforço e de orçamento de raciocínio:
    "gpt-6-sol_high" → ("gpt-6-sol", "high"); "claude-opus-4-5-20251101-high-32k" → ("claude-opus-4-5", "high-32k")."""
    s = slug(name)
    if s.endswith("-non-reasoning"):
        return s.removesuffix("-non-reasoning"), "non-reasoning"
    tails = []
    while True:
        head, _, tail = s.rpartition("-")
        if not head or not (tail in EFFORTS or re.fullmatch(r"\d+k", tail)):
            break
        tails.insert(0, tail)
        s = DATE_SUFFIX.sub("", head)
    return s, "-".join(tails) or None


def canonical(name: str, known: set[str] | None = None) -> tuple[str, str | None]:
    """model_id + variant. Com `known`, só separa o sufixo se a base existir no catálogo
    (evita quebrar nomes de produto como "qwen3.8-max")."""
    base, variant = split_variant(name)
    if variant and known is not None and base not in known:
        return slug(name), None
    return base, variant


def load_aliases(path: Path = ALIASES_FILE) -> dict[str, str]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return {r["alias"]: r["model_id"] for r in csv.DictReader(f)}
