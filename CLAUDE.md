# CLAUDE.md — bench-ai-model

Coleta semanal de benchmarks e preços (padrão e batch) de LLMs, com pipeline Parquet bronze→silver→gold e dashboard na Vercel.

Este projeto segue o framework **WAT** (Workflows, Agents, Tools): a IA raciocina e coordena; código
determinístico executa. Você é a camada **Agent**.

**Tradeoff assumido:** estas regras priorizam cautela sobre velocidade. Em tarefas triviais, use bom senso.

**Este projeto é versionado no GitHub** (`rodrigoakiray/bench-ai-model`, público) e roda nele: o **GitHub Actions**
coleta e processa os dados toda semana e commita o snapshot; a **Vercel** publica `site/` a cada push em `main`.
Código, workflows, agents, configuração, `datalake/` e `site/data/` entram no git (os dados são públicos).
**Segredos nunca entram:** `.env`, `credentials.json`, `token.json`, chaves. `raw/` e `.tmp/` também ficam fora.
Antes de todo commit, rode `python tools/check_secrets.py`. Não há hooks vigiando: `permissions.deny` cobre os
padrões óbvios; o resto depende de você seguir este arquivo.

**O bot do Actions commita em `main` toda segunda-feira.** Rode `git pull` antes de começar qualquer trabalho.

## 1. Arquitetura WAT

| Camada | Onde | O que é |
|---|---|---|
| **Workflows** | `workflows/*.md` | SOPs em linguagem natural: objetivo, inputs, tools a usar, outputs esperados, edge cases |
| **Agents** | você (+ `.claude/agents/`) | Lê o workflow, sequencia as tools, trata falhas, pergunta quando necessário |
| **Tools** | `tools/*.py` | Scripts determinísticos: chamadas de API, transformações, I/O, queries. Credenciais só em `.env` |

**Atenção aos nomes:** `workflows/` são os SOPs deste framework (para você ler). `.github/workflows/` são os
pipelines do **GitHub Actions** (YAML executado pelo GitHub). São coisas diferentes.

**Por que:** se cada passo tem 90% de acerto, cinco passos encadeados caem para ~59%. Execução determinística
nos scripts mantém você no que faz bem — orquestrar e decidir — em vez de tentar fazer tudo diretamente.

Exemplo: precisa atualizar os dados? Não baixe nada à mão. Leia `workflows/weekly_refresh.md` e execute
`python tools/run_pipeline.py`.

## 2. Camadas de dados

Fluxo obrigatório: `raw/` → `datalake/bronze/` → `datalake/silver/` → `datalake/gold/` → `site/data/` → Vercel.

| Camada | Conteúdo | Regra |
|---|---|---|
| `raw/` | Arquivos recebidos de fora, exatamente como chegaram (CSV, XLSX, JSON, PDF, dumps) | **Somente leitura.** Nunca editar, renomear ou apagar. Nunca versionar. |
| `datalake/bronze/` | Cópia fiel das fontes (APIs/downloads) em Parquet, todas as colunas como texto, com colunas de linhagem `_source`, `_source_file`, `_ingested_at` | **Append-only** por data. Sem limpeza. Escrita só por tool. |
| `datalake/silver/` | Dados limpos: tipos corretos, deduplicados, nomes de modelo normalizados, schema fixo e validado | **Idempotente:** reprocessar gera o mesmo resultado. |
| `datalake/gold/` | Tabela única `model_scorecard`: uma linha por (snapshot, modelo), pronta para o dashboard | Uma tabela = uma pergunta de negócio. |
| `site/data/` | JSON exportado do gold, lido pelo dashboard | Gerado só por `tools/export_site.py`. Nunca editar à mão. |
| `.tmp/` | Intermediários, cache, relatórios de nomes não casados | **Descartável.** Pode ser apagado a qualquer momento. |

Convenções:
- Caminho: `datalake/<camada>/llm/<tabela>/dt=YYYY-MM-DD/part-0.parquet`. Reexecutar no mesmo dia sobrescreve a partição.
- Formato padrão: Parquet. JSON só em `site/data/`.
- Toda tool que escreve no datalake imprime no stdout o que gravou (caminho, nº de linhas, timestamp).
- Nunca escreva numa camada pulando a anterior: `gold/` nasce de `silver/`; `silver/` nasce de `bronze/`.
- Antes de promover para a camada seguinte, rode `tools/validate_layer.py --layer <camada> --table <tabela>`
  (o `run_pipeline.py` já faz isso).
- `datalake/` e `site/data/` são versionados porque o runner do Actions é efêmero: o git é o histórico semanal.
  Só dados **públicos** entram aqui. Qualquer dado sensível ou pessoal vai para `raw/`/`.tmp/` e nunca é publicado.
- Nomes de modelo: normalização em `tools/model_ids.py`; correções manuais em `config/model_aliases.csv`.
  Descontos de batch sem dado oficial: `config/batch_discounts.csv` (com `as_of` e `source_url`).
- Índices por aplicação (programação, agentes, pesquisa, raciocínio, matemática, escrita, negócios, jurídico,
  saúde, ciência, visão): `config/applications.json` liga cada coluna do gold a um benchmark do silver e diz
  quais compõem cada aplicação. Mudar o mapeamento é editar esse arquivo e rodar `build_scorecard.py` +
  `export_site.py`; não codifique benchmarks nas tools.
- **Atribuição obrigatória** no dashboard: Artificial Analysis, Epoch AI (CC-BY 4.0), LMArena (CC-BY 4.0), LiteLLM.

## 3. Como operar

1. **Leia o workflow antes de agir.** Se não existe workflow para a tarefa, diga isso e proponha criar um —
   não improvise a sequência.
2. **Procure tools existentes antes de criar.** `ls tools/` primeiro. Só crie script novo quando nada cobre a tarefa.
3. **Quando algo falhar:** leia a mensagem de erro inteira e o trace; corrija o script; reteste. Se a tool usa
   API paga ou créditos, **peça confirmação antes de rodar de novo**. Documente no workflow o que aprendeu
   (rate limits, timing, comportamento inesperado). A Artificial Analysis tem limite de 100 requisições por dia.
4. **Mantenha os workflows vivos.** Descobriu método melhor ou restrição nova? Atualize o workflow.
   Mas **não crie nem sobrescreva workflows sem perguntar**, salvo instrução explícita. Eles são suas instruções:
   preserve e refine, não descarte após um uso.
5. **Após editar `tools/*.py`:** `python -m py_compile <arquivo>` e `ruff check <arquivo>`; rode `pytest`.
   Sem hook fazendo isso por você, é sua responsabilidade.
6. **Git:** commits pequenos, uma intenção por commit, mensagem `tipo: o que mudou` (`feat`, `fix`, `chore`,
   `docs`). Sequência obrigatória: `git add <arquivos específicos>` → `python tools/check_secrets.py` →
   `git commit`. Nunca `git add -A` sem ler o `git status` antes. Nunca `--force` em `main`, nunca `--no-verify`.
   Push só quando o usuário pedir ou o workflow mandar. Todo push em `main` vira deploy de produção na Vercel.

## 4. Segredos

- Toda credencial vive **só** no `.env` (local) e nos **GitHub Secrets** (Actions). O `.env` está no `.gitignore`.
  Você não lê nem edita o `.env` (permissão negada); as tools o carregam em runtime com `python-dotenv`.
- Precisa de uma chave nova? Adicione o **nome** dela ao `.env.example` (sem valor), peça ao humano para preencher
  o `.env` e para rodar `gh secret set <NOME>`. Nunca peça ao usuário para colar o valor no chat.
- Nunca escreva chaves, tokens, senhas ou URLs com credenciais em código, workflow, teste, log ou commit.
  Fixtures de teste usam valores obviamente falsos (`"fake-key"`), nunca formatos reais.
- `tools/check_secrets.py` é obrigatório antes de cada commit. Se acusar algo: **não commite**, remova do stage,
  e conte ao usuário o que encontrou e onde. Falso positivo confirmado pelo humano: marque a linha com `nosecret`.
- **Se um segredo chegou ao GitHub** (o repo é público): avise o usuário imediatamente.
  A ordem é (1) o humano **revoga e gera a chave de novo**, (2) só depois limpa o histórico (`git filter-repo`) e
  força o push — isso é ação do humano, você não faz `--force`. Reescrever histórico sem revogar não resolve nada.

## 5. Disciplina de código

### Pense antes de codar
- Declare suas suposições. Em dúvida, pergunte.
- Várias interpretações possíveis? Apresente-as; não escolha em silêncio.
- Existe caminho mais simples? Diga. Discorde quando fizer sentido.
- Algo confuso? Pare. Nomeie o que está confuso. Pergunte.

### Simplicidade primeiro
- Nada além do que foi pedido. Sem abstrações para código de uso único. Sem "flexibilidade" ou
  "configurabilidade" não solicitada. Sem tratamento de erro para cenários impossíveis.
- Escreveu 200 linhas que cabem em 50? Reescreva.
- Pergunta-guia: *"um engenheiro sênior diria que isso está complicado demais?"* Se sim, simplifique.

### Mudanças cirúrgicas
- Toque só no necessário. Não "melhore" código, comentários ou formatação adjacentes. Não refatore o que não
  está quebrado. Siga o estilo existente, mesmo que você fizesse diferente.
- Código morto pré-existente: mencione, não apague.
- Órfãos criados pela **sua** mudança (imports, variáveis, funções): remova.
- Teste: toda linha alterada deve rastrear diretamente ao pedido do usuário. `git diff` mostra isso.

### Execução orientada a objetivo
Transforme tarefas em critérios verificáveis:
- "Adicionar validação" → "escrever testes para inputs inválidos, depois fazê-los passar"
- "Corrigir o bug" → "escrever teste que reproduz o bug, depois fazê-lo passar"
- "Refatorar X" → "garantir que os testes passam antes e depois"
- "Adicionar a fonte X" → "tool roda, grava em `bronze/`, `validate_layer.py --layer bronze --table X` passa"

Em tarefas multi-passo, declare o plano:
```
1. [passo] → verificar: [checagem]
2. [passo] → verificar: [checagem]
3. [passo] → verificar: [checagem]
```
Critério forte = você itera sozinho até passar. Critério fraco ("faz funcionar") = pedidos constantes
de esclarecimento.

## 6. Loop de auto-melhoria

Cada falha é chance de fortalecer o sistema:
1. Identifique o que quebrou
2. Corrija a tool
3. Verifique que a correção funciona
4. Atualize o workflow com a nova abordagem
5. Siga em frente com um sistema mais robusto

## 7. Claude Code: permissões e agents

- **`.claude/settings.json`** (versionado, vale para todo clone) — regras `deny`: leitura e edição de `.env` e
  credenciais, edição do `.gitignore` e de `raw/`, `git add -f`, `git push --force`, `git commit --no-verify`, e
  `rm`/`mv` sobre `raw/` e `datalake/`. Se uma ação sua for negada, **é intencional — não contorne** (nem por
  encadeamento de comandos, nem por caminho alternativo). Explique ao usuário o que queria fazer.
  Ajustes pessoais vão em `.claude/settings.local.json` (ignorado pelo git).
- **`.claude/agents/`** — subagentes com escopo restrito. Delegue quando a tarefa casar com a descrição:
  `data-engineer` (pipelines bronze→silver→gold), `qa-reviewer` (revisão de diff, somente leitura),
  `workflow-writer` (redigir/atualizar SOPs, sempre com aprovação).

## 8. Nunca

- Commitar `.env`, `credentials.json`, `token.json`, chaves, `raw/`, `.tmp/` ou `settings.local.json`.
- Commitar dado não público em `datalake/` ou `site/data/` (o repo e o site são públicos).
- Forçar rastreamento de arquivo ignorado: `git add -f`, `git add --force`.
- Commitar sem rodar `tools/check_secrets.py` antes.
- Remover entradas de segredo do `.gitignore` (você não o edita; só o humano).
- Escrever valores de credenciais em qualquer arquivo que não seja o `.env`.
- `git push --force` em `main`; `git commit --no-verify`.
- Editar, renomear ou apagar arquivos em `raw/`.
- Editar dados do datalake ou de `site/data/` manualmente — sempre via tool.
- Rodar tool com custo (API paga, créditos) uma segunda vez sem confirmação.
- Criar ou sobrescrever workflow sem perguntar.
- Publicar o dashboard sem a atribuição das fontes.

## 9. Estrutura

```
.gitignore         # segredos e temporários fora do git
.claude/
  settings.json    # permissions.deny (versionado)
  settings.local.json   # pessoal (ignorado)
  agents/          # subagentes
.github/workflows/ # GitHub Actions: weekly-refresh.yml (coleta semanal + commit do snapshot)
workflows/         # SOPs: o quê e como
tools/             # scripts Python: execução determinística (inclui check_secrets.py)
tests/             # pytest; fixtures falsas em tests/fixtures/
config/            # tabelas manuais versionadas: aliases de modelo, descontos de batch, aplicações × benchmarks
raw/               # fontes originais, imutáveis (ignorado)
datalake/          # bronze/ silver/ gold/ em Parquet (versionado; só dados públicos)
site/              # dashboard estático publicado pela Vercel; site/data/ é gerado pelo pipeline
.tmp/              # descartável (ignorado)
.env.example       # nomes das chaves (versionado)
.env               # segredos (ignorado; só o humano edita)
```

---

**Resumo:** você fica entre o que eu quero (workflows) e o que é executado (tools). Leia as instruções, decida
bem, chame as tools certas, recupere-se de erros e melhore o sistema. Pragmático. Confiável. Sempre aprendendo.
