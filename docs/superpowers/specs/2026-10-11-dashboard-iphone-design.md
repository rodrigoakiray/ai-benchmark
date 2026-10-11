# Dashboard no iPhone — design

Data: 2026-10-11 · Status: design aprovado no chat; spec aguardando revisão.

## Objetivo
As mesmas 9 análises do dashboard, otimizadas para o iPhone em pé: cada análise ocupa uma tela, sem rolagem
vertical, com navegação entre telas (o mesmo princípio do notebook).

## Situação atual (393×659, Safari em pé)
- Menu e filtros ocupam 470 dos 659 px; toda análise começa abaixo da dobra.
- Cada tela tem de 1.000 a 1.800 px de altura e rola.
- Três tabelas vazam para os lados numa área útil de 346 px: Melhor por aplicação (418 px), Aplicabilidade
  (900 px) e Todos os modelos (960 px).

## Decisão
**Mesmo site e mesmo endereço**: o layout do iPhone entra como mais uma faixa de CSS e JS em `site/`. Um só código,
então as análises continuam idênticas por construção.
Rejeitada: página separada (`/iphone.html`), porque seriam duas páginas para manter em sincronia, um link a mais e uma
refatoração do `app.js` para servir às duas.

## Alcance
- **Faixa celular:** `(max-width: 599.98px) and (min-height: 480px)`. Cobre o iPhone em pé, de 375 a 440 px de
  largura e de ~548 a ~780 px de altura útil no Safari.
- **Faixa celular baixo** (iPhone SE): a mesma, com `max-height: 600px`, para espaçamentos e fontes um pouco menores.
- **Não muda:** notebook (≥ 960×560), monitor (≥ 1280×860), celular deitado e tablets (continuam no layout que rola).
- **Fora do alcance:** PWA/ícone na tela inicial, pipeline e dados.

## Estrutura e navegação (faixa celular)
- **Barra no topo (48 px):** `☰ <nome da análise>` abre a gaveta do menu; `‹` e `›` levam à análise anterior e à
  seguinte (desabilitados nas pontas); `Filtros` mostra quantos filtros estão fora do padrão.
- **Gesto:** deslizar o dedo para o lado na área da análise troca de análise (≥ 60 px na horizontal, mais horizontal
  que vertical, < 700 ms). Não dispara dentro de áreas que rolam para o lado (tabela de Todos os modelos, fileira de
  aplicações) nem com gaveta ou painel abertos.
- **Gaveta do menu:** o `.sidebar` atual (marca, 9 análises, data dos dados, tema), entrando pela esquerda sobre um
  fundo escurecido.
- **Painel de filtros:** o `form.filters` atual, subindo de baixo (até 85% da altura), com os mesmos 6 controles, os
  laboratórios destacados (chips) e o botão "Pronto".
- Gaveta e painel fecham com "Pronto", toque no fundo ou Esc; o foco volta ao botão que os abriu.
- **Campos com 16 px de texto** (o iOS dá zoom em campos menores). Alvos de toque: ≥ 44 px na barra, na gaveta, no
  painel e nas abas; ≥ 36 px na paginação.
- **Altura:** cada análise ocupa o que sobra de `100dvh` abaixo da barra, sem rolagem. `FIXED_LAYOUT` passa a incluir
  a faixa celular, então as tabelas calculam quantas linhas cabem e paginam o resto.
- Notas das telas: até 3 linhas (2 no SE), com reticências se passarem disso.

## As 9 telas no iPhone
| # | Tela | No iPhone |
|---|---|---|
| 1 | Visão geral | Frase da semana (~22 px), 4 números em grade 2×2, legenda curta e dispersão no resto da altura. Rótulo só no líder (já é assim abaixo de 640 px); margens menores e nome do eixo X curto. |
| 2 | Melhor por aplicação | 3 colunas (aplicação, mais capaz, custo-benefício), com "pts · preço" embaixo do nome do modelo. Saem a descrição e a contagem (ficam em Como é medido). Se não couber (SE), some a segunda linha (`compact`). |
| 3 | Aplicabilidade | As 11 colunas na largura: cabeçalho vertical com a primeira palavra do rótulo, células de ~23 px, sem o nome do laboratório. ~18 modelos por página. |
| 4 | Ranking e orçamento | Abas "Ranking \| Orçamento"; só a aba visível é desenhada. |
| 5 | Padrão ou batch | Gráfico na altura toda; nome do eixo curto. |
| 6 | Evolução | Gráfico na altura toda; datas do eixo sem sobreposição. |
| 7 | Todos os modelos | Coluna do modelo fixa à esquerda (`position: sticky`) e as demais rolando para o lado dentro da tabela, a única rolagem lateral (11 colunas não cabem em 360 px). ~12 modelos por página. |
| 8 | Como é medido | Aplicações numa fileira de botões que rola para o lado; benchmarks paginados quando não cabem (Programação tem 10). |
| 9 | Fontes e leitura | Abas "Fontes \| Como ler"; a atribuição das fontes continua em Fontes. |

## Arquivos
- `site/index.html`: barra do topo, abas de Ranking/Orçamento e de Fontes/Como ler, contêiner de chips e botão
  "Pronto" no form, fundo escurecido.
- `site/styles.css`: blocos da faixa celular e da faixa celular baixo; barra, gaveta, painel e abas (ocultos fora do
  celular).
- `site/app.js`: `PHONE` (matchMedia), `FIXED_LAYOUT` com a faixa celular, navegação (botões, gesto, título), gaveta e
  painel, abas, contador de filtros, chips nos dois contêineres, rótulos curtos no mapa de calor, paginação dos
  benchmarks e ajustes de gráfico para tela estreita.

## Critérios de aceite: smoke test no fim
Script descartável com Playwright, no scratchpad (não entra no repo).
- **iPhone:** WebKit com emulação de celular (toque, DPR 3, user agent do iOS) em 375×548 (SE), 390×664 (12 a 14),
  393×659 (15 e 16), 430×739 (Plus e Pro Max) e 440×760.
- **PC, como referência:** Chromium em 1440×930 e 1366×657.
- **Em cada tela e tamanho:** sem rolagem vertical nem estouro lateral da página; nenhum contêiner cortando conteúdo
  sem querer (só a tabela de Todos os modelos rola para o lado, de propósito); gráficos desenhados (SVG com marcas e
  tamanho > 0); menor fonte visível ≥ 11 px; alvos de toque conforme acima; console sem erros.
- **Interações no iPhone:** abrir e fechar gaveta e painel; trocar um filtro (Batch) e ver o contador; `‹ ›`; deslizar
  para trocar de análise; tocar num ponto e ver o tooltip; abas; rolar a tabela de modelos com o nome fixo.
- **Desktop:** medidas antes × depois idênticas em 1366×657 e 1440×930 (já com o ajuste de 1440).
- **Relatório:** tabela passa/falha por tela × aparelho e uma folha de contato com as capturas do iPhone ao lado das do
  PC, revisada visualmente.
- **Opcional:** abrir no iPhone de verdade pela rede local.
