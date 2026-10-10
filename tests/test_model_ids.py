import pytest

from model_ids import canonical, slug, split_variant


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("anthropic/claude-opus-5.5", "claude-opus-5-5"),
        ("Claude Opus 5.5", "claude-opus-5-5"),
        ("gemini/gemini-3.5-flash", "gemini-3-5-flash"),
        ("gpt-4o-2024-08-06", "gpt-4o"),
        ("claude-opus-4-5-20251101", "claude-opus-4-5"),
        ("fireworks_ai/accounts/fireworks/models/glm-5p3", "glm-5-3"),
        ("claude-4-1-opus", "claude-opus-4-1"),
        ("mistral/codestral-latest", "codestral"),
    ],
)
def test_slug(name, expected):
    assert slug(name) == expected


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("gpt-6.1-sol_max", ("gpt-6-1-sol", "max")),
        ("claude-opus-5.5-high", ("claude-opus-5-5", "high")),
        ("muse-spark-1.2 (xHigh)", ("muse-spark-1-2", "xhigh")),
        ("gpt-5-5-non-reasoning", ("gpt-5-5", "non-reasoning")),
        ("claude-opus-4-5-20251101-high-32k", ("claude-opus-4-5", "high-32k")),
        ("gpt-5.4-2026-03-05_xhigh", ("gpt-5-4", "xhigh")),
        ("deepseek-v4-pro", ("deepseek-v4-pro", None)),
    ],
)
def test_split_variant(name, expected):
    assert split_variant(name) == expected


def test_canonical_keeps_product_name_when_base_unknown():
    # "Max" é nome de produto no Qwen, não esforço: a base "qwen3-8" não existe no catálogo
    assert canonical("qwen3.8-max", known={"qwen3-8-max"}) == ("qwen3-8-max", None)
    assert canonical("claude-opus-5.5-high", known={"claude-opus-5-5"}) == ("claude-opus-5-5", "high")
