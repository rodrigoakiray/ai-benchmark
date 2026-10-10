import json
from pathlib import Path

import ingest_artificial_analysis
import ingest_litellm
import lake

FIXTURES = Path(__file__).parent / "fixtures"


def test_litellm_keeps_text_models_and_serializes_lists():
    data = json.loads((FIXTURES / "litellm_sample.json").read_text(encoding="utf-8"))
    df = ingest_litellm.to_frame(data)
    assert sorted(df["model_key"]) == ["fake-chat-model", "fake-pro-model"]
    row = df.set_index("model_key").loc["fake-chat-model"]
    assert json.loads(row["supported_endpoints"]) == ["/v1/chat/completions", "/v1/batch"]


def test_aa_flattens_nested_fields():
    page = json.loads((FIXTURES / "aa_page.json").read_text(encoding="utf-8"))
    df = ingest_artificial_analysis.to_frame([page])
    assert {"slug", "model_creator.name", "evaluations.artificial_analysis_intelligence_index",
            "pricing.price_1m_input_tokens"} <= set(df.columns)
    assert len(df) == 2


def test_to_bronze_is_text_with_lineage():
    page = json.loads((FIXTURES / "aa_page.json").read_text(encoding="utf-8"))
    df = lake.to_bronze(ingest_artificial_analysis.to_frame([page]), "fake", "fake://source")
    assert {"_source", "_source_file", "_ingested_at"} <= set(df.columns)
    assert all(str(t) == "str" for t in df.dtypes)
    assert df["release_date"].isna().sum() == 1  # nulo continua nulo, não vira "None"
