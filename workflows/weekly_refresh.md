# Workflow: atualização semanal de benchmarks e preços

## Objetivo
Coletar benchmarks e preços (padrão e batch) dos LLMs, processar bronze → silver → gold e publicar o dashboard na Vercel.

## Inputs
| Input | Obrigatório | Default |
|---|---|---|
| `--dt` (data do snapshot) | não | hoje (UTC) |
| `--skip-ingest` (reprocessa o bronze já baixado de `--dt`) | não | desligado |

## Tools (na ordem)
O `tools/run_pipeline.py` executa tudo abaixo e para no primeiro erro. Rode passo a passo só para depurar.
1. `tools/ingest_epoch.py` → `bronze/llm/epoch_benchmarks`, `epoch_eci`, `epoch_models`, `epoch_benchmark_meta`
2. `tools/ingest_lmarena.py` → `bronze/llm/lmarena_text`, `lmarena_webdev`, `lmarena_search`, `lmarena_vision`
3. `tools/ingest_litellm.py` → `bronze/llm/litellm_prices` (fixado no SHA do commit do LiteLLM)
4. `tools/ingest_artificial_analysis.py` → `bronze/llm/aa_models` (sem chave: pula com aviso)
5. `tools/validate_layer.py --layer bronze --table <cada tabela>` → verificar: `OK`
6. `tools/clean_llm.py` → `silver/llm/benchmark_scores`, `models`, `prices` → verificar: `validate_layer --layer silver`
7. `tools/build_scorecard.py` → `gold/llm/model_scorecard`, com os índices por aplicação de `config/applications.json` → verificar: `validate_layer --layer gold`
8. `tools/export_site.py` → `site/data/scorecard.json` e `meta.json`

No GitHub Actions (`.github/workflows/weekly-refresh.yml`, segunda 08:00 BRT): pipeline → `check_secrets.py` →
commit de `datalake/` e `site/data/` pelo bot → push → a Vercel publica.

## Outputs
- Datalake: `datalake/<camada>/llm/<tabela>/dt=YYYY-MM-DD/part-0.parquet`; gold em `datalake/gold/llm/model_scorecard/model_scorecard.parquet` (todo o histórico)
- Deliverable cloud: dashboard na Vercel (projeto ligado ao repo, Root Directory `site`)
- Relatórios de nomes sem par entre fontes: `.tmp/unmatched_<fonte>.csv`

## Variáveis de ambiente usadas
- `ARTIFICIAL_ANALYSIS_API_KEY` — API gratuita da Artificial Analysis (local: `.env`; Actions: GitHub Secret)
- `GITHUB_TOKEN` — só no Actions, para a API do GitHub não limitar a consulta do SHA do LiteLLM

## Fontes e licenças
| Fonte | O que traz | Licença |
|---|---|---|
| Artificial Analysis (`/api/v2/language/models/free`) | Intelligence/Coding/Agentic Index, preço padrão | grátis, **atribuição obrigatória**, 100 req/dia |
| Epoch AI (`benchmark_data.zip`) | benchmarks, ECI, organização, datas, pesos abertos | CC-BY 4.0 |
| LMArena (dataset no Hugging Face) | Arena Elo, categoria `overall` | CC-BY 4.0 |
| LiteLLM (`model_prices_and_context_window.json`) | preços padrão e `*_batches` | MIT |

## Edge cases
- Fonte fora do ar ou schema mudou → a tool falha com mensagem clara e nada é commitado; ajuste a tool e rode `gh workflow run weekly-refresh.yml`.
- Chave da AA ausente ou expirada → AA é pulada; a métrica principal cai para o ECI. Peça ao humano para atualizar o secret.
- Modelo importante sem par entre fontes → veja `.tmp/unmatched_*.csv` e adicione a linha `alias,model_id` em `config/model_aliases.csv`.
- Preço batch sem dado oficial → `config/batch_discounts.csv` (fator por provider, com `as_of` e `source_url`). Revise quando um provider mudar a política.
- Rodar duas vezes no mesmo dia → sobrescreve a partição do dia (idempotente).
- Benchmark novo numa aplicação → adicione a coluna em `benchmarks` e o nome dela na aplicação em `config/applications.json`. O `benchmark` precisa ser idêntico ao rótulo do silver: nome da Epoch, `AA ... Index` ou `Arena <arena>: <categoria>`.
- Aplicação com poucos modelos (Pesquisa e fatos, Agentes) → é falta de dado nas fontes, não erro; a Search Arena publica com menos frequência.

## Lições aprendidas
- 2026-10-10 — LiteLLM: modelos "pro" da OpenAI estão em `mode=responses`, não `chat`; a ingestão aceita os dois.
- 2026-10-10 — Epoch usa dois nomes (versão `gpt-6.1-sol_max` e grupo `GPT-6.1 Sol`); `clean_llm` escolhe o que casa com as outras fontes.
- 2026-10-10 — Fireworks escreve versões com "p" (`glm-5p3`); `model_ids.slug` normaliza.
- 2026-10-10 — `python -m http.server` sobre o Google Drive cortou o JSON de ~900 KB; para pré-visualizar, sirva `site/` a partir de um disco local.
- 2026-10-10 — Índices por aplicação: só com Elo do LMArena, o líder da arena virava líder de "Raciocínio" sem nenhum teste objetivo. Regra adotada: 2 benchmarks e ao menos 1 teste objetivo (`min_objective`; Escrita usa 0 porque preferência humana é o critério).
