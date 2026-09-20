# API Diagnóstico Territorial — Rede Cidadã

API intermediária do hotsite de diagnóstico territorial.

## Versão atual

API: **1.3.0**

## Endpoints

- `GET /api/health`
- `GET /api/diagnostico/{codigoIBGE}`
- `GET /api/ivcad/{codigoIBGE}`

Exemplo:

`/api/diagnostico/3106200?nome=Belo%20Horizonte&uf=MG&refresh=1`

## Fontes tratadas

- IBGE / Censo / Agregados
- IBGE Cidades + INEP
- IPS Brasil como contingência para IVCAD geral e IDEB
- MDS / RMA público por unidade para CRAS, CREAS, Centro POP, MSE e Pop Rua
- MDS / RI Social e VIS DATA 3 para Cadastro Único
- SICONFI / Tesouro Nacional para orçamento

A API usa cache no servidor, CORS aberto para o hotsite e contingências textuais quando uma fonte pública não responde diretamente ao Render.

## Render

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`
- Root Directory: vazio

O servidor escuta `process.env.PORT`.
