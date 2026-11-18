'use strict';
const {getDiagnosis} = require('./diagnostico');

function factualAnalysis(d) {
  const find=id=>d.indicators.find(x=>x.id===id&&x.status==='verificado');
  const facts=[];
  if(find('populacao_censo'))facts.push('O Censo de 2022 permite dimensionar a população residente, mas não identifica isoladamente demandas de qualificação, proteção social ou empregabilidade.');
  if(find('populacao_estimativa'))facts.push('Há uma estimativa populacional mais recente; ela não deve ser confundida com contagem censitária.');
  if(find('orcamento_assistencia'))facts.push('A despesa liquidada em Assistência Social indica execução fiscal da função, não disponibilidade imediata de recursos para novas parcerias.');
  const missing=d.modules.filter(m=>m.status!=='verificado').map(m=>m.name);
  return {
    mode:'regras', title:'Leitura técnica preliminar',
    paragraphs:[
      'O território de '+d.municipio.nome+'/'+d.municipio.uf+' possui indicadores oficiais parcialmente carregados. A leitura apresentada é preliminar e não constitui diagnóstico social conclusivo.',
      ...facts,
      missing.length?'As bases de '+missing.join(', ')+' ainda carecem de integração estruturada e validação para este município. Sem essas informações não é adequado hierarquizar demandas ou estimar público-alvo.':'As fontes identificadas permitem avançar para uma leitura temática, respeitando as competências de cada indicador.',
      'Próxima etapa sugerida: validar o Cadastro Único, os indicadores de escolaridade, o potencial de aprendizagem e a rede SUAS, depois confrontá-los com escuta territorial e a capacidade de execução da Rede Cidadã.'
    ], recommendations:[
      {title:'Aprofundar evidências sociais',priority:'Alta',reason:'Completar indicadores de vulnerabilidade, educação e trabalho antes de decidir pela proposta.'},
      {title:'Mapear capacidade local',priority:'Alta',reason:'Confirmar equipamentos, redes de proteção, parceiros e demanda efetiva no território.'},
      {title:'Analisar viabilidade',priority:'Condicional',reason:'Dimensionar público, parceiros, custos e fontes de financiamento com dados confirmados.'}
    ], limitations:['Texto analítico determinístico; IA generativa não configurada.','Não há inferência causal nem substituição de evidências ausentes.']
  };
}
async function analyze(d) {
  const fallback=factualAnalysis(d);
  if(!process.env.OPENAI_API_KEY)return fallback;
  const trusted = {
    municipio:d.municipio,
    indicators:d.indicators.filter(x=>x.status==='verificado'),
    missing:d.modules.filter(x=>x.status!=='verificado').map(x=>({name:x.name,reason:x.reason})),
    sources:d.sources
  };
  try {
    const r=await fetch('https://api.openai.com/v1/responses',{
      method:'POST', signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.OPENAI_API_KEY},
      body:JSON.stringify({
        model:process.env.OPENAI_MODEL || 'gpt-5-mini',
        store:false,
        instructions:'Você é analista técnico de projetos sociais no Brasil. Produza uma análise social crítica, em português brasileiro, baseada SOMENTE no JSON fornecido. Não fabrique números, municípios, dados, rankings, bases, causas, comparações ou conclusões. Separe fato, hipótese e recomendação. Indique explicitamente as lacunas que impedem decisão. Não proponha projeto como viável sem comprovação. Responda em 4 parágrafos claros sem markdown e limite a 280 palavras.',
        input:JSON.stringify(trusted),
        max_output_tokens:650
      })
    });
    if(!r.ok)throw new Error('IA indisponível');
    const data=await r.json();
    const generated=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
    if(!generated || generated.length>7000)throw new Error('Sem resultado');
    return {mode:'ia',title:'Análise social assistida por IA',paragraphs:generated.split(/\n\s*\n/).filter(Boolean),
      recommendations:fallback.recommendations,
      limitations:['Análise interpretativa gerada por IA, sujeita a revisão técnica humana.','A IA utiliza apenas os indicadores verificados entregues nesta consulta.']};
  }catch(e){return {...fallback,limitations:[...fallback.limitations,'A chamada à IA não pôde ser concluída; usada análise técnica determinística.']}}
}
module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Método não permitido'});
  const ibge=String(req.body?.ibge||'');
  if(!/^\d{7}$/.test(ibge))return res.status(400).json({error:'Código IBGE inválido'});
  try{
    const d=await getDiagnosis(ibge);
    const result=await analyze(d);
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({municipio:d.municipio, generatedAt:d.generatedAt,analysis:result});
  }catch(e){return res.status(502).json({error:'Não foi possível produzir análise com evidências verificadas.'})}
};
module.exports.analyze=analyze;
module.exports.factualAnalysis=factualAnalysis;