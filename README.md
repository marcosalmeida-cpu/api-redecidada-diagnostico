# API Diagnóstico Territorial — Rede Cidadã

API intermediária do hotsite de diagnóstico socioterritorial.

## Arquitetura v2

A API principal foi redesenhada para o plano Free do Render:

- não baixa ZIP/XLSX nacionais durante a pesquisa;
- não processa microdados pesados em memória;
- cada tema é um módulo independente;
- falha de um módulo não interrompe o diagnóstico;
- fontes pesadas são convertidas periodicamente em snapshots municipais pequenos;
- SICONFI e Transferegov permanecem como consultas estruturadas ao vivo;
- IVCAD é complementar e nunca bloqueia os demais módulos.

## Endpoints

- `GET /api/health`
- `GET /api/diagnostico/{codigoIBGE}`
- `GET /api/modulo/{modulo}/{codigoIBGE}`

Para refazer uma consulta:

`?refresh=1`

No endpoint geral, `refresh=1` é utilizado pelo hotsite para tentar novamente módulos pendentes, parciais ou com falha.

## Módulos

- perfil
- vulnerabilidade
- educacao
- trabalho
- aprendizagem
- protecao
- publicos
- condicoes
- capacidade
- orcamento
- recursos
- ecossistema

## Fontes

### Consultas leves/estruturadas

- IBGE Localidades
- SICONFI / Tesouro Nacional
- Transferegov

O hotsite possui contingência direta no IBGE/SIDRA para perfil e escolaridade básica enquanto os snapshots periódicos ainda não estiverem disponíveis.

### Snapshots periódicos

- Cadastro Único / MDS
- IVCAD, quando houver fonte estruturada válida
- INEP / Censo Escolar / IDEB
- RAIS / Novo Caged
- MTE/SIT / potencial de aprendizagem
- Censo SUAS
- públicos específicos IBGE/MDS
- SINISA + indicadores selecionados do SUS
- IBGE MUNIC
- CNEAS

Os snapshots ficam em `data/snapshots/*.json` e usam o código IBGE de 7 dígitos como chave.

## Render

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`
- Root Directory: vazio

A API não possui dependências de processamento pesado no runtime.
