# Workflow: <nome>

## Objetivo
<uma frase: o que este workflow entrega>

## Inputs
| Input | Obrigatório | Default |
|---|---|---|

## Tools (na ordem)
1. `tools/<script>.py --arg x` → verificar: <checagem>
2. `tools/<script>.py --arg y` → verificar: <checagem>

## Outputs
- Camada do datalake gravada: `datalake/<camada>/<domínio>/<tabela>/`
- Deliverable cloud: <onde o usuário vê o resultado>

## Variáveis de ambiente usadas
- `NOME_DA_CHAVE` — para quê (valor só no .env)

## Edge cases
- <situação> → <o que fazer>

## Lições aprendidas
- <data> — <rate limit / quirk / tempo médio / erro recorrente e solução>
