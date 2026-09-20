# API Diagnóstico Territorial — Rede Cidadã

API intermediária para o hotsite de diagnóstico territorial.

## Endpoints

- `GET /api/health`
- `GET /api/diagnostico/{codigoIBGE}`
- `GET /api/ivcad/{codigoIBGE}`

Exemplo:

`/api/diagnostico/3106200?nome=Belo%20Horizonte&uf=MG`

## Render

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`
- Root Directory: deixar vazio

O servidor escuta `process.env.PORT` e está preparado para CORS.
