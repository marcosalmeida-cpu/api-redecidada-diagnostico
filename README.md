# API Diagnóstico Territorial — Rede Cidadã

API intermediária do hotsite de diagnóstico socioterritorial da Rede Cidadã.

## Versão atual

**1.4.0**

A API foi organizada para funcionar como camada de normalização entre fontes oficiais e o hotsite. O navegador não precisa baixar XLSX, ZIP ou consultar painéis pesados diretamente.

## Endpoint integrado

- `GET /api/diagnostico/{codigoIBGE}`

Exemplo:

`/api/diagnostico/3106200?nome=Belo%20Horizonte&uf=MG&refresh=1`

O retorno inclui:

- dados consolidados por tema;
- status individual das fontes;
- plano de fontes;
- síntese analítica territorial;
- oportunidades de aprofundamento;
- aprendizagem profissional;
- transferências especiais/emendas quando localizadas.

## Rotas temáticas

- `GET /api/ivcad/{codigoIBGE}`
- `GET /api/educacao/{codigoIBGE}`
- `GET /api/suas/{codigoIBGE}`
- `GET /api/orcamento/{codigoIBGE}`
- `GET /api/aprendizagem/{codigoIBGE}`
- `GET /api/emendas/{codigoIBGE}`
- `GET /api/vulnerabilidade/{codigoIBGE}`

## Fontes e hierarquia

### Demografia e território
IBGE / SIDRA / Censo.

### Vulnerabilidade
MDS / Cadastro Único / IVCAD / VIS DATA. Dados ausentes permanecem indisponíveis; não são estimados.

### Educação
IBGE Agregados + INEP, com contingências estruturadas.

### SUAS
RMA público processado no servidor e estrutura preparada para Censo SUAS.

### Trabalho e aprendizagem
MTE/SIT, eSocial, RAIS/Novo Caged quando disponíveis. A planilha oficial de potencial municipal de aprendizagem é processada no servidor.

### CNAP
O ZIP/CSV oficial do CNAP é baixado, descompactado e filtrado pela API, eliminando a dependência de Google Sheets e CORS no hotsite.

### Orçamento
SICONFI / Tesouro Nacional.

### Emendas e recursos públicos
Transferegov — Transferências Especiais, cruzando beneficiário, plano de ação, empenhos e relatórios de gestão. Portais estaduais e municipais entram como conectores específicos quando disponibilizam fonte estruturada.

## Síntese analítica

O endpoint de diagnóstico devolve um bloco `analysis` com textos construídos apenas a partir dos dados efetivamente carregados. A síntese é usada no hotsite e no documento PDF.

## Render

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`
- Root Directory: vazio

O servidor usa `process.env.PORT`, CORS aberto para o hotsite e cache territorial.
