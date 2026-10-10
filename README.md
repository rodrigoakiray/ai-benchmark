# bench-ai-model

Coleta semanal de benchmarks e preços (padrão e batch) de LLMs, com pipeline Parquet bronze→silver→gold e dashboard na Vercel.

- **Dashboard:** site estático em `site/`, publicado pela Vercel a cada push em `main`.
- **Atualização:** o GitHub Actions (`.github/workflows/weekly-refresh.yml`) roda toda segunda-feira, commita o snapshot e a Vercel republica.
- **Fontes:** Artificial Analysis, Epoch AI (CC-BY 4.0), LMArena (CC-BY 4.0) e LiteLLM (MIT). Detalhes em [`workflows/weekly_refresh.md`](workflows/weekly_refresh.md).
- **Instruções para o agente:** [`CLAUDE.md`](CLAUDE.md).

## Configurar

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Linux/macOS: .venv/bin/pip
cp .env.example .env                               # e preencha ARTIFICIAL_ANALYSIS_API_KEY
```

A chave da Artificial Analysis é gratuita (artificialanalysis.ai/insights). Sem ela o pipeline roda, mas sem o AA Intelligence Index.
No GitHub, a mesma chave vai em *Settings → Secrets and variables → Actions*: `gh secret set ARTIFICIAL_ANALYSIS_API_KEY`.

**Segredos ficam só no `.env` (ignorado). Antes de commitar: `python tools/check_secrets.py`.**

Opcional, por clone: rodar o `check_secrets.py` automaticamente a cada commit.

```bash
printf '#!/usr/bin/env bash\npython tools/check_secrets.py || { echo "commit bloqueado: possível segredo"; exit 1; }\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## Rodar

```bash
python tools/run_pipeline.py                # baixa tudo, valida cada camada e gera site/data/
python tools/run_pipeline.py --skip-ingest  # reprocessa o bronze de hoje sem baixar de novo
pytest -q && ruff check tools tests
```

Para ver o dashboard localmente, sirva a pasta `site/` (por exemplo `npx serve site`) e abra o endereço indicado.

## Estrutura

```
tools/        scripts do pipeline (ingest_*, clean_llm, build_scorecard, export_site, run_pipeline)
config/       aliases de nomes de modelo e descontos de batch por provider
datalake/     bronze/ silver/ gold/ em Parquet (versionado: dados públicos)
site/         dashboard (index.html, styles.css, app.js) e site/data/ gerado pelo pipeline
workflows/    SOPs do agente (≠ .github/workflows/, que são os pipelines do GitHub Actions)
```
