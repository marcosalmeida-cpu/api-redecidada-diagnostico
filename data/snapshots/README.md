# Snapshots territoriais

Arquivos desta pasta são bases municipais normalizadas para leitura rápida pela API.

Cada JSON usa o código IBGE de 7 dígitos:

```json
{
  "3106200": {
    "reference": "2026-07",
    "...": "..."
  }
}
```

| Arquivo | Fonte principal | Atualização esperada |
|---|---|---|
| perfil.json | IBGE / Censo | anual ou quando houver nova estimativa |
| cadunico.json | MDS / Cadastro Único | mensal |
| ivcad.json | MDS / IVCAD | quando houver exportação estruturada |
| educacao.json | INEP / Censo Escolar / IDEB | anual |
| trabalho.json | RAIS + Novo Caged | mensal |
| aprendizagem.json | MTE/SIT / eSocial | mensal |
| suas.json | Censo SUAS | anual |
| publicos.json | IBGE + MDS | conforme fonte |
| condicoes.json | IBGE + SINISA + SUS | anual/periódica |
| capacidade.json | IBGE MUNIC + Censo SUAS | anual |
| ecossistema.json | CNEAS | periódica |

Regra: o Web Service do Render nunca deve baixar/processar a base nacional pesada durante uma pesquisa do usuário.
