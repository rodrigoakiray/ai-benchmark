import pandas as pd
import pytest

from build_scorecard import blended, pareto
from clean_llm import org, select_prices

DISCOUNTS = pd.DataFrame({"provider": ["openai", "deepseek"], "batch_factor": [0.5, None]})


def cand(model_id, provider, inp, out, b_in=float("nan"), b_out=float("nan"), priority=0, key=None):
    return {"model_id": model_id, "provider": provider, "source": "litellm", "source_model_key": key or model_id,
            "input_usd_1m": inp, "output_usd_1m": out, "cached_input_usd_1m": float("nan"),
            "batch_input_usd_1m": b_in, "batch_output_usd_1m": b_out,
            "priority": priority, "dated": False, "key_len": len(key or model_id)}


def test_select_prices_batch_status():
    cands = pd.DataFrame([
        cand("a", "openai", 2.0, 8.0, 1.0, 4.0),  # oficial
        cand("b", "openai", 2.0, 8.0),  # sem batch publicado → fator 0.5
        cand("c", "deepseek", 0.5, 1.0),  # provider sem batch
    ])
    out = select_prices(cands, DISCOUNTS).set_index("model_id")
    assert out.loc["a", "batch_status"] == "official"
    assert out.loc["b", "batch_status"] == "estimated"
    assert out.loc["b", "batch_output_usd_1m"] == pytest.approx(4.0)
    assert out.loc["c", "batch_status"] == "unavailable"
    assert pd.isna(out.loc["c", "batch_input_usd_1m"])


def test_select_prices_prefers_first_party_provider():
    cands = pd.DataFrame([
        cand("m", "together_ai", 1.0, 1.0, priority=15, key="together_ai/m"),
        cand("m", "openai", 3.0, 3.0, priority=0),
    ])
    out = select_prices(cands, DISCOUNTS)
    assert len(out) == 1
    assert out.loc[0, "provider"] == "openai"


def test_blended_is_3_to_1():
    assert blended(pd.Series([4.0]), pd.Series([20.0]))[0] == pytest.approx(8.0)


def test_pareto():
    score = pd.Series([50, 40, 45, 60, None], index=list("abcde"))
    price = pd.Series([1.0, 2.0, 0.5, 10.0, 0.1], index=list("abcde"))
    # b é dominado por a (mais caro e pior); e não tem score
    assert pareto(score, price).to_dict() == {"a": True, "b": False, "c": True, "d": True, "e": False}


def test_org_normalization():
    assert org("Google DeepMind,Google") == "Google"
    assert org("tencent") == "Tencent"
    assert org("") is None
