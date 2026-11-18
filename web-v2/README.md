# Diagnóstico Territorial Integrado — Rede Cidadã V2
**Homologação, não produção.** O site V11 `diagnostico-redecidada.vercel.app` permanece intacto.

## Objetivo
Nova interface responsiva para subsidiar decisões sobre projetos sociais. Sem inventar valores, sem converter indisponibilidade em zero e com rastreabilidade das competências.

## Arquitetura
- `index.html`, `styles.css`, `app.js`: interface e consultas sem armazenamento pessoal.
- `api/municipios.js`: busca oficial de municípios pelo IBGE.
- `api/diagnostico.js`: Censo 2022, estimativa, SICONFI, validação dos indicadores; módulos não integrados explicitamente sinalizados.
- `api/analise.js`: análise técnica regrada; IA generativa opcional se houver `OPENAI_API_KEY` e `OPENAI_MODEL`, configuradas **somente** no ambiente do servidor.
- `api/relatorio.js`: PDF próprio (pdf-lib) com dados **reconsultados no servidor**, fontes, lacunas e análise técnica determinística.

## Fontes públicas
IBGE API / SIDRA: https://servicodados.ibge.gov.br/api/docs/
Tesouro SICONFI: https://www.tesourotransparente.gov.br/consultas/consultas-siconfi/siconfi-api-de-dados-abertos
MDS: https://www.gov.br/mds/pt-br/orgaos/SAGICAD/dados-e-ferramentas-informacionais/dados-e-ferramentas-do-cadastro-unico/
INEP IDEB: https://www.gov.br/inep/pt-br/areas-de-atuacao/pesquisas-estatisticas-e-indicadores/ideb/resultados
MTE aprendizagem: https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/areas-de-atuacao/insercao-de-aprendiz-1

## Advertências de integridade
1. `generatedAt` é a hora da consulta; `period` é a competência da fonte.
2. MDS/IVCAD, INEP IDEB, MTE, RAIS e rede SUAS **ainda não estão integrados** nesta etapa; não divulgar como bases funcionais.
3. A conta da API precisa de rotina institucional de importação de dados em nível municipal, verificação de esquema e competência.
4. A IA é opcional, não deve criar indicadores nem substituir deliberação de equipe técnica.
5. PDF é relatório **preliminar de homologação**. Deve passar por conferência técnica para uso externo.

## Implantação
Aplicação orientada à Vercel, com Node 22+ e `pdf-lib`. Não publicar no domínio V11 antes de testes de integridade, acessibilidade, segurança, desempenho e validação territorial.
