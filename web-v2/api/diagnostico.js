'use strict';

const IBGE = 'https://servicodados.ibge.gov.br';
const SICONFI = 'https://apidatalake.tesouro.gov.br';
const SOURCES = {
  ibge: { name: 'IBGE · Censo e estimativas', url: 'https://servicodados.ibge.gov.br/api/docs/' },
  tesouro: { name: 'Tesouro Nacional · SICONFI', url: 'https://www.tesourotransparente.gov.br/consultas/consultas-siconfi/siconfi-api-de-dados-abertos' },
  mds: { name: 'MDS · Cadastro Único e IVCAD', url: 'https://www.gov.br/mds/pt-br/orgaos/SAGICAD/dados-e-ferramentas-informacionais/dados-e-ferramentas-do-cadastro-unico/' },
  inep: { name: 'INEP · IDEB', url: 'https://www.gov.br/inep/pt-br/areas-de-atuacao/pesquisas-estatisticas-e-indicadores/ideb/resultados' },
  mte: { name: 'MTE · Potencial de cota de aprendizagem', url: 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/areas-de-atuacao/insercao-de-aprendiz-1' },
  suas: { name: 'MDS · Censo SUAS', url: 'https://www.gov.br/mds/pt-br/acoes-e-programas/suas/gestao-do-suas/vigilancia-socioassistencial-1/censo-suas' }
};

async function json(url, ms = 13000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Fonte respondeu HTTP ' + response.status);
  const kind = response.headers.get('content-type') || '';
  if (!kind.includes('json')) throw new Error('Formato de resposta não é JSON');
  return response.json();
}
function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '' || String(value).trim() === '...') return null;
  const raw = String(value).trim();
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  return Number.isFinite(n) ? n : null;
}
function seriesValues(data, code) {
  const selected = {};
  for (const item of (Array.isArray(data) ? data : [])) {
    const id = String(item.id ?? item.variavelId ?? '');
    for (const group of (item.resultados || [])) {
      for (const serie of (group.series || [])) {
        if (String(serie.localidade?.id || '') !== code) continue;
        for (const [year, raw] of Object.entries(serie.serie || {})) {
          const value = numeric(raw);
          if (value !== null && /^\d{4}$/.test(year)) selected[id + ':' + year] = value;
        }
      }
    }
  }
  return selected;
}
function indicator(id, label, value, unit, period, source, note = '') {
  return { id, label, value: Number.isFinite(value) ? value : null, unit, period, source, note, status: Number.isFinite(value) ? 'verificado' : 'indisponivel' };
}
function asFinite(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
async function getDiagnosis(code) {
  if (!/^\d{7}$/.test(String(code || ''))) throw Object.assign(new Error('Código IBGE inválido'), { status: 400 });
  const codigo = String(code);
  const m = await json(IBGE + '/api/v1/localidades/municipios/' + codigo, 12000);
  if (String(m.id || '') !== codigo) throw Object.assign(new Error('Município não identificado no IBGE'), { status: 404 });
  const uf = m?.microrregiao?.mesorregiao?.UF?.sigla || m?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla || 'UF';
  const municipio = { codigoIBGE: codigo, nome: m.nome, uf };
  const results = await Promise.allSettled([
    json(IBGE + '/api/v3/agregados/4714/periodos/2022/variaveis/93|6318|614?localidades=N6[' + codigo + ']'),
    json(IBGE + '/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[' + codigo + ']'),
    fetchBudget(codigo)
  ]);
  const census = results[0].status === 'fulfilled' ? seriesValues(results[0].value, codigo) : {};
  const estimated = results[1].status === 'fulfilled' ? seriesValues(results[1].value, codigo) : {};
  const estimateYears = Object.keys(estimated).filter(k => k.startsWith('9324:')).map(k => Number(k.split(':')[1])).sort((a,b) => b-a);
  const latestYear = estimateYears[0] || null;
  const budget = results[2].status === 'fulfilled' ? results[2].value : null;
  const data = [
    indicator('populacao_censo', 'População residente · Censo', asFinite(census['93:2022']), 'pessoas', '2022', 'ibge'),
    indicator('populacao_estimativa', 'População estimada', latestYear ? asFinite(estimated['9324:' + latestYear]) : null, 'pessoas', latestYear ? String(latestYear) : '—', 'ibge'),
    indicator('area', 'Área territorial', asFinite(census['6318:2022']), 'km²', '2022', 'ibge'),
    indicator('densidade', 'Densidade demográfica', asFinite(census['614:2022']), 'hab./km²', '2022', 'ibge'),
    indicator('orcamento_assistencia', 'Despesas liquidadas · Assistência Social', budget?.assist ?? null, 'R$', budget?.period ?? '—', 'tesouro', 'Despesa por função. Não representa orçamento disponível para novos projetos.'),
    indicator('orcamento_educacao', 'Despesas liquidadas · Educação', budget?.education ?? null, 'R$', budget?.period ?? '—', 'tesouro'),
    indicator('orcamento_saude', 'Despesas liquidadas · Saúde', budget?.health ?? null, 'R$', budget?.period ?? '—', 'tesouro')
  ];
  const modules = [
    {id:'demografia', name:'Perfil demográfico',status:data.slice(0,4).some(v=>v.status==='verificado')?'verificado':'indisponivel',source:'ibge'},
    {id:'orcamento', name:'Orçamento público',status:data.slice(4).some(v=>v.status==='verificado')?'verificado':'indisponivel',source:'tesouro'},
    {id:'cadunico', name:'Cadastro Único e IVCAD',status:'nao_integrado',source:'mds',reason:'Integração estruturada municipal ainda não validada.'},
    {id:'educacao', name:'Educação e IDEB',status:'nao_integrado',source:'inep',reason:'Importação do IDEB 2025 por município pendente.'},
    {id:'aprendizagem', name:'Aprendizagem profissional',status:'nao_integrado',source:'mte',reason:'Importação do arquivo municipal do MTE pendente.'},
    {id:'suas', name:'Proteção social e Censo SUAS',status:'nao_integrado',source:'suas',reason:'Importação dos dados municipais de unidades e serviços pendente.'},
    {id:'trabalho', name:'Trabalho e renda',status:'nao_integrado',source:'mte',reason:'RAIS/Novo Caged ainda não validados.'},
    {id:'publicos', name:'Públicos prioritários',status:'nao_integrado',source:'mds',reason:'Sem agregados estruturados validados para este município.'}
  ];
  const valid = data.filter(d => d.status === 'verificado').length;
  return { version: '2.0-homologacao', generatedAt: new Date().toISOString(), municipio, indicators:data, modules,
    sources: SOURCES, quality:{verified:valid,total:data.length,coveragePercent:Math.round(valid/data.length*100),
      disclaimer:'Cobertura se refere somente aos indicadores demonstrativos integrados, não à completude do diagnóstico territorial.'},
    notes:['Ausência de informação não significa zero.', 'Competência estatística e data da consulta são conceitos diferentes.',
      'Comparações e recomendações dependem de indicadores equivalentes e validados.'] };
}
async function fetchBudget(codigo) {
  for (const year of [2025, 2024]) {
    try {
      const u = new URL(SICONFI + '/ords/siconfi/tt/dca');
      u.searchParams.set('an_exercicio', String(year));
      u.searchParams.set('no_anexo', 'DCA-Anexo I-E');
      u.searchParams.set('id_ente', codigo);
      const response = await json(u.toString(), 14000);
      const rows = Array.isArray(response?.items) ? response.items : [];
      if (!rows.length) continue;
      function get(code) {
        const matches = rows.filter(x => String(x.cod_interno ?? '').trim() === code && /despesas liquidadas/i.test(String(x.coluna ?? '')));
        const values = matches.map(x => numeric(x.valor)).filter(x => x !== null && x >= 0);
        return values.length === 1 ? values[0] : null; // recusa ambiguidades contábeis
      }
      const assist=get('08'), education=get('12'), health=get('10');
      if ([assist,education,health].some(v=>v!==null)) return {assist,education,health,period:String(year),reference:'DCA-Anexo I-E · despesas liquidadas'};
    } catch (_err) { /* informa indisponibilidade pelos indicadores, sem inventar valores */ }
  }
  return null;
}
module.exports = async function handler(req,res) {
  if (req.method !== 'GET') return res.status(405).json({error:'Método não permitido'});
  try {
    const data = await getDiagnosis(req.query.ibge);
    res.setHeader('Cache-Control','public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json(data);
  } catch(e) {
    return res.status(e.status || 502).json({error: e.status ? e.message : 'Não foi possível validar as fontes oficiais agora.',detail: e.status ? undefined : 'Nova tentativa recomendada.'});
  }
};
module.exports.getDiagnosis = getDiagnosis;
module.exports.SOURCES = SOURCES;
