import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||8787);
const TTL=6*60*60*1000;
const cache=new Map();
const SNAP=path.join(__dirname,'data','snapshots');
const IBGE='https://servicodados.ibge.gov.br/api/v1/localidades/municipios/';
const IBGE_AGG='https://servicodados.ibge.gov.br/api/v3/agregados';
const SICONFI='https://apidatalake.tesouro.gov.br/ords/siconfi/tt/dca';
const TRANSFERE='https://api-publica.transferegov.gestao.gov.br/especiais/';

const clean=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const safe=v=>finite(v)?Number(v):null;
function num(v){
  if(typeof v==='number')return Number.isFinite(v)?v:NaN;
  let s=String(v??'').trim();
  if(!s||s==='-'||s==='—')return NaN;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  else s=s.replace(/[^0-9.\-]/g,'');
  const n=Number(s);return Number.isFinite(n)?n:NaN;
}
async function request(url,ms=12000){
  const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),ms);
  try{
    const r=await fetch(url,{signal:ctrl.signal,headers:{'user-agent':'RedeCidada-Diagnostico/2.0','accept':'application/json,*/*'}});
    if(!r.ok)throw new Error(String(r.status)+' '+r.statusText);
    return r;
  }finally{clearTimeout(t)}
}
const fetchJson=async(url,ms=12000)=>(await request(url,ms)).json();
const fetchText=async(url,ms=10000)=>(await request(url,ms)).text();
function send(res,status,body){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type','cache-control':'no-store'});
  res.end(JSON.stringify(body));
}
async function municipality(ibge,nome='',uf=''){
  const m={ibge:String(ibge),nome,uf};
  if(m.nome&&m.uf)return m;
  try{
    const d=await fetchJson(IBGE+m.ibge,8000);
    m.nome||=d?.nome||'';
    m.uf||=d?.microrregiao?.mesorregiao?.UF?.sigla||d?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla||'';
  }catch{}
  return m;
}
async function snapshot(name,ibge){
  try{
    const raw=await readFile(path.join(SNAP,name+'.json'),'utf8');
    const all=JSON.parse(raw);
    return all?.[String(ibge)]??null;
  }catch{return null}
}
function result(name,status,data,source,message='',reference=''){
  return {name,status,data:data??null,source,reference,message,updatedAt:new Date().toISOString()};
}
async function ibgeMeta(table){return fetchJson(IBGE_AGG+'/'+table+'/metadados',10000)}
function totalCategory(c){const cats=Array.isArray(c?.categorias)?c.categorias:[];return cats.find(a=>clean(a.nome)==='total')?.id??cats[0]?.id??'all'}
function classQuery(meta,expand=[]){return (meta?.classificacoes||[]).map(x=>x.id+'['+(expand.some(rx=>rx.test(clean(x.nome)))?'all':totalCategory(x))+']').join('|')}
async function ibgeData(table,period,vars,m,classif=''){const u=new URL(IBGE_AGG+'/'+table+'/periodos/'+period+'/variaveis/'+vars);u.searchParams.set('localidades','N6['+m.ibge+']');if(classif)u.searchParams.set('classificacao',classif);return fetchJson(u.toString(),12000)}
function aggFlat(data){const out=[];for(const v of(Array.isArray(data)?data:[]))for(const r of(v.resultados||[])){const labels=(r.classificacoes||[]).flatMap(x=>Object.values(x.categoria||{}));for(const s of(r.series||[]))for(const [period,value] of Object.entries(s.serie||{}))out.push({variableId:v.id||v.variavelId||'',variable:v.variavel||'',value:num(value),labels,period})}return out}
async function liveProfile(m){
  const snap=await snapshot('perfil',m.ibge);if(snap)return result('perfil','ok',snap,'IBGE · snapshot','Base territorial municipal carregada.',snap.reference||'');
  const out={};let refs=[];
  try{const d=await ibgeData(6579,'-1','9324',m);const r=aggFlat(d).filter(x=>finite(x.value)).sort((a,b)=>String(b.period).localeCompare(String(a.period)))[0];if(r){out.population=Number(r.value);out.populationEstimate=Number(r.value);refs.push('estimativa '+r.period)}}catch{}
  try{const d=await ibgeData(4714,2022,'93|6318|614',m);const rows=aggFlat(d).filter(x=>finite(x.value));for(const x of rows){if(String(x.variableId)==='93')out.populationCensus=Number(x.value);if(String(x.variableId)==='6318')out.area=Number(x.value);if(String(x.variableId)==='614')out.density=Number(x.value)}refs.push('Censo 2022')}catch{}
  try{const meta=await ibgeMeta(9514);const d=await ibgeData(9514,2022,'93',m,classQuery(meta,[/idade|grupo de idade/]));const rows=aggFlat(d).filter(x=>finite(x.value));const groups={};for(const x of rows){const lab=(x.labels||[]).find(a=>/anos|100/i.test(String(a)));if(lab)groups[lab]=Math.max(groups[lab]||0,Number(x.value))}const vals=Object.entries(groups).map(([label,value])=>({label,value}));out.ageGroups=vals;out.youth15_29=vals.filter(x=>/15 a 19|20 a 24|25 a 29/i.test(x.label)).reduce((s,x)=>s+x.value,0)||null;out.older60=vals.filter(x=>/60 a|65 a|70 a|75 a|80 a|85 a|90 a|95 a|100/i.test(x.label)).reduce((s,x)=>s+x.value,0)||null}catch{}
  try{
    const meta=await ibgeMeta(9605);
    const d=await ibgeData(9605,2022,'all',m,classQuery(meta,[/cor ou raca/]));
    const rows=aggFlat(d).filter(x=>finite(x.value));
    const wanted=['Branca','Preta','Parda','Amarela','Indígena'];
    const pctRows=rows.filter(x=>clean(x.variable).includes('percentual'));
    const absRows=rows.filter(x=>!clean(x.variable).includes('percentual'));
    out.race=wanted.map(label=>{
      const p=pctRows.find(x=>(x.labels||[]).some(a=>clean(a)===clean(label)));
      const a=absRows.find(x=>(x.labels||[]).some(v=>clean(v)===clean(label)));
      return {label,value:safe(a?.value),percent:safe(p?.value)};
    }).filter(x=>finite(x.value)||finite(x.percent));
  }catch{}
  try{
    const meta=await ibgeMeta(9514);
    const d=await ibgeData(9514,2022,'93',m,classQuery(meta,[/sexo/]));
    const rows=aggFlat(d).filter(x=>finite(x.value));
    const byRx=rx=>rows.find(x=>(x.labels||[]).some(a=>rx.test(clean(a))));
    const women=byRx(/mulher/), men=byRx(/homem/);
    const totalRow=rows.find(x=>(x.labels||[]).some(a=>clean(a)==='total'));
    let womenValue=finite(women?.value)?Number(women.value):null;
    let menValue=finite(men?.value)?Number(men.value):null;
    const officialTotal=finite(totalRow?.value)?Number(totalRow.value):(finite(out.populationCensus)?Number(out.populationCensus):null);
    if(!finite(menValue)&&finite(officialTotal)&&finite(womenValue))menValue=officialTotal-womenValue;
    if(!finite(womenValue)&&finite(officialTotal)&&finite(menValue))womenValue=officialTotal-menValue;
    const total=(finite(menValue)?Number(menValue):0)+(finite(womenValue)?Number(womenValue):0);
    if(total)out.sex=[
      {label:'Mulheres',value:safe(womenValue),percent:100*Number(womenValue||0)/total},
      {label:'Homens',value:safe(menValue),percent:100*Number(menValue||0)/total}
    ];
  }catch{}
  if(!out.population&&out.populationCensus)out.population=out.populationCensus;
  if(!Object.keys(out).length)return result('perfil','bad',null,'IBGE · SIDRA/Censo','IBGE não respondeu nesta consulta.','');
  out.reference=[...new Set(refs)].join(' · ');return result('perfil','ok',out,'IBGE · SIDRA/Censo','Perfil territorial carregado automaticamente.',out.reference);
}
async function liveEducation(m){
  const snap=await snapshot('educacao',m.ibge);const out=snap?{...snap}:{};
  if(!finite(out.literacyPercent))try{const meta=await ibgeMeta(9543);const d=await ibgeData(9543,2022,'all',m,classQuery(meta,[]));const r=aggFlat(d).find(x=>finite(x.value)&&clean(x.variable).includes('taxa de alfabetizacao'));if(r)out.literacyPercent=Number(r.value)}catch{}
  if(!out.instruction)try{const meta=await ibgeMeta(10061);const d=await ibgeData(10061,2022,'all',m,classQuery(meta,[/nivel de instrucao/]));const rows=aggFlat(d).filter(x=>finite(x.value)&&!clean(x.variable).includes('percentual'));const labels=['Sem instrução e fundamental incompleto','Fundamental completo e médio incompleto','Médio completo e superior incompleto','Superior completo'];const values=labels.map(l=>rows.find(x=>(x.labels||[]).some(a=>clean(a)===clean(l)))?.value||0),total=values.reduce((a,b)=>a+b,0);if(total){out.instruction={labels,values,total};out.lowEducationPercent=100*(values[0]+values[1])/total}}catch{}
  const ok=[out.literacyPercent,out.lowEducationPercent,out.enrollments,out.idebInitial,out.idebFinal].some(finite);
  return ok?result('educacao',snap?'ok':'partial',out,snap?'INEP + IBGE snapshot':'IBGE · Censo 2022',snap?'Educação carregada.':'Escolaridade carregada automaticamente; Censo Escolar/IDEB dependem do snapshot periódico.',out.reference||'Censo 2022'):result('educacao','bad',null,'IBGE/INEP','Fontes educacionais não responderam.','');
}
function stripHtml(s){return String(s||'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function htmlTables(html){const out=[];for(const tm of String(html||'').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){const rows=[];for(const rm of tm[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...rm[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>stripHtml(x[1]));if(cells.length)rows.push(cells)}if(rows.length)out.push(rows)}return out}
function periodCell(v){const m=String(v||'').match(/(0?[1-9]|1[0-2])\s*\/\s*(20\d{2})/);return m?{month:Number(m[1]),year:Number(m[2]),key:Number(m[2])*100+Number(m[1])}:null}
function latestSeries(rows){const found=[];for(const row of rows||[]){const pi=row.findIndex(x=>periodCell(x));if(pi<0)continue;const p=periodCell(row[pi]);let value=NaN;for(let i=pi+1;i<row.length;i++){const v=num(row[i]);if(finite(v)){value=Number(v);break}}if(finite(value))found.push({...p,value})}found.sort((a,b)=>b.key-a.key);return found[0]||null}
async function ibgeCategoryPercent(table,m,rx){
  try{const meta=await ibgeMeta(table);const cls=(meta?.classificacoes||[]).find(x=>(x.categorias||[]).some(a=>rx.test(clean(a.nome))));if(!cls)return null;const cq=(meta.classificacoes||[]).map(x=>x.id+'['+(x.id===cls.id?'all':totalCategory(x))+']').join('|');const rows=aggFlat(await ibgeData(table,2022,'all',m,cq)).filter(x=>finite(x.value));const perc=rows.filter(x=>clean(x.variable).includes('percentual')&&(x.labels||[]).some(a=>rx.test(clean(a))));if(perc.length)return perc.reduce((s,x)=>s+Number(x.value),0);const counts=rows.filter(x=>!clean(x.variable).includes('percentual'));for(const variable of [...new Set(counts.map(x=>String(x.variableId)))]){const pool=counts.filter(x=>String(x.variableId)===variable);const total=pool.find(x=>(x.labels||[]).some(a=>clean(a)==='total'));const targets=pool.filter(x=>(x.labels||[]).some(a=>rx.test(clean(a))));if(total&&targets.length&&Number(total.value)>0)return 100*targets.reduce((s,x)=>s+Number(x.value),0)/Number(total.value)}return null}catch{return null}
}
async function liveConditions(m){
  const snap=await snapshot('condicoes',m.ibge);const out=snap?{...snap}:{};
  if(!finite(out.waterPercent))out.waterPercent=await ibgeCategoryPercent(6803,m,/rede geral de distribuicao/);
  if(!finite(out.sewerPercent))out.sewerPercent=await ibgeCategoryPercent(6805,m,/rede geral|rede pluvial|fossa septica/);
  if(!finite(out.wastePercent))out.wastePercent=await ibgeCategoryPercent(6892,m,/coletad/);
  const ok=[out.waterPercent,out.sewerPercent,out.wastePercent,out.apsCoverage,out.ubs,out.caps].some(finite);
  return ok?result('condicoes',snap?'ok':'partial',out,snap?'IBGE + SINISA + SUS snapshot':'IBGE · Censo 2022','Condições domiciliares carregadas automaticamente; saúde e SINISA entram quando o snapshot estiver disponível.',out.reference||'Censo 2022'):result('condicoes','bad',null,'IBGE + SINISA + SUS','Condições de vida não responderam nesta consulta.','');
}
async function liveCadunico(m){
  const snap=await snapshot('cadunico',m.ibge);if(snap)return snap;
  const code6=String(m.ibge).slice(0,6);
  try{const url='https://aplicacoes.cidadania.gov.br/vis/data3/v.php?vsc=Sp8th1&ag=m&codigo='+code6;const html=await fetchText(url,9000);const text=stripHtml(html);if(m.nome&&!clean(text).includes(clean(m.nome)))throw new Error('município divergente');const series=htmlTables(html).map(latestSeries).filter(Boolean);const poverty=series[0]||null,low=series[1]||null,above=series[2]||null;const ref=[poverty,low,above].filter(Boolean).sort((a,b)=>b.key-a.key)[0]||null;const families=(low&&above&&low.key===above.key)?low.value+above.value:null;if([families,low?.value,poverty?.value].some(finite))return {families:safe(families),lowIncomeFamilies:safe(low?.value),povertyFamilies:safe(poverty?.value),aboveHalfFamilies:safe(above?.value),people:null,street:null,reference:ref?(String(ref.month).padStart(2,'0')+'/'+ref.year):'',source:'MDS · VIS DATA 3'}}catch{}
  try{
    const urls=[
      'https://aplicacoes.mds.gov.br/sagi/RIv3/geral/index.php?codigo='+m.ibge,
      'https://aplicacoes.mds.gov.br/sagi/RIv3/geral/index.php?codigo='+String(m.ibge).slice(0,6)
    ];
    for(const url of urls){
      try{
        const text=stripHtml(await fetchText(url,8000));
        const pick=(rxs)=>{for(const rx of rxs){const mm=text.match(rx);if(mm){const v=num(mm[1]);if(finite(v))return Number(v)}}return null};
        const families=pick([/(\d[\d\.]{1,})\s*fam[ií]lias[^.]{0,100}cadastro [uú]nico/i,/fam[ií]lias[^\d]{0,120}(\d[\d\.]{1,})/i]);
        const people=pick([/(\d[\d\.]{1,})\s*pessoas[^.]{0,100}cadastro [uú]nico/i,/pessoas[^\d]{0,120}(\d[\d\.]{1,})/i]);
        const low=pick([/(\d[\d\.]{1,})\s*(?:fam[ií]lias|pessoas)[^.]{0,120}baixa renda/i,/baixa renda[^\d]{0,120}(\d[\d\.]{1,})/i]);
        if([families,people,low].some(finite))return {families:safe(families),people:safe(people),lowIncomeFamilies:safe(low),povertyFamilies:null,street:null,reference:'',source:'MDS · RI Social'};
      }catch{}
    }
  }catch{}
  return null;
}
async function liveVulnerability(m){const cad=await liveCadunico(m),iv=await snapshot('ivcad',m.ibge);if(cad||iv)return result('vulnerabilidade',cad?(iv?'ok':'partial'):'partial',{cadunico:cad||null,ivcad:iv||null},'MDS · Cadastro Único / IVCAD',cad?'Cadastro Único consultado automaticamente.':'IVCAD disponível sem Cadastro Único.',cad?.reference||iv?.reference||'');return result('vulnerabilidade','bad',{cadunico:null,ivcad:null},'MDS · Cadastro Único / IVCAD','Cadastro Único não respondeu e não há snapshot local. IVCAD não bloqueia os demais módulos.','')}
async function snapshotModule(name,m,source,label){
  const d=await snapshot(name,m.ibge);
  return d
    ? result(name,'ok',d,source,'Base municipal carregada.',d.reference||'')
    : result(name,'pending',null,source,label+' ainda não está no snapshot periódico. O restante do diagnóstico continua normalmente.','');
}
function dca(items,code){
  const liq=items.filter(x=>clean(x.coluna).includes('despesas liquidadas'));
  const r=liq.find(x=>String(x.cod_interno??'').trim()===code)||liq.find(x=>clean(x.conta).startsWith(clean(code)+' -'));
  return r?num(r.valor):NaN;
}
async function budget(m){
  for(const y of [2025,2024,2023,2022,2021]){
    try{
      const u=new URL(SICONFI);
      u.searchParams.set('an_exercicio',String(y));
      u.searchParams.set('no_anexo','DCA-Anexo I-E');
      u.searchParams.set('id_ente',m.ibge);
      const d=await fetchJson(u.toString(),12000);
      if(!Array.isArray(d?.items)||!d.items.length)continue;
      const items=d.items,liq=items.filter(x=>clean(x.coluna).includes('despesas liquidadas'));
      const funcs=liq.filter(x=>/^\d{2}$/.test(String(x.cod_interno??'')));
      const total=funcs.reduce((s,x)=>s+(finite(num(x.valor))?num(x.valor):0),0);
      return result('orcamento','ok',{
        year:y,total:safe(total),assist:safe(dca(items,'08')),health:safe(dca(items,'10')),education:safe(dca(items,'12')),
        work:safe(dca(items,'11')),urbanism:safe(dca(items,'15')),housing:safe(dca(items,'16')),sanitation:safe(dca(items,'17'))
      },'SICONFI / Tesouro Nacional','Despesas liquidadas por função.','DCA '+y);
    }catch{}
  }
  return result('orcamento','bad',null,'SICONFI / Tesouro Nacional','DCA não respondeu nesta consulta.','');
}
async function tg(table,params={}){
  const u=new URL(TRANSFERE+table);
  for(const [k,v] of Object.entries(params))if(v!==null&&v!==undefined&&v!=='')u.searchParams.set(k,String(v));
  u.searchParams.set('page_size','100');
  const d=await fetchJson(u.toString(),12000);
  return Array.isArray(d?.data)?d.data:[];
}
async function resources(m){
  try{
    let bens=[];
    for(const id of [m.ibge,m.ibge.slice(0,6)]){
      try{bens=await tg('beneficiarios_especiais',{id_ente:id});if(bens.length)break}catch{}
    }
    if(!bens.length)return result('recursos','partial',{count:0,indicated:0,items:[]},'Transferegov · Transferências Especiais','Nenhum beneficiário municipal localizado.','API pública');
    let plans=[];
    for(const b of bens.slice(0,4)){try{plans.push(...await tg('planos_acao_especiais',{id_beneficiario:b.id_beneficiario}))}catch{}}
    const uniq=new Map();for(const p of plans)uniq.set(String(p.id_plano_acao),p);plans=[...uniq.values()];
    const indicated=plans.reduce((s,p)=>s+(finite(num(p.valor_custeio_plano_acao))?num(p.valor_custeio_plano_acao):0)+(finite(num(p.valor_investimento_plano_acao))?num(p.valor_investimento_plano_acao):0),0);
    const items=plans.sort((a,b)=>Number(b.ano_plano_acao||0)-Number(a.ano_plano_acao||0)).slice(0,8).map(p=>({
      year:Number(p.ano_emenda_parlamentar_plano_acao||p.ano_plano_acao)||null,
      author:p.nome_parlamentar_emenda_plano_acao||'',
      object:p.detalhamento_objeto||p.nome_objeto||'',
      status:p.situacao_plano_acao||'',
      value:safe((finite(num(p.valor_custeio_plano_acao))?num(p.valor_custeio_plano_acao):0)+(finite(num(p.valor_investimento_plano_acao))?num(p.valor_investimento_plano_acao):0))
    }));
    return result('recursos','ok',{count:plans.length,indicated:safe(indicated),items},'Transferegov · Transferências Especiais','Valores indicados; execução local não é presumida.','API pública');
  }catch(e){return result('recursos','bad',null,'Transferegov',e?.message||'Consulta sem retorno.','')}
}
const loaders={
  perfil:liveProfile,
  vulnerabilidade:liveVulnerability,
  educacao:liveEducation,
  trabalho:m=>snapshotModule('trabalho',m,'MTE · RAIS/Novo Caged snapshot','Trabalho e renda'),
  aprendizagem:m=>snapshotModule('aprendizagem',m,'MTE/SIT · eSocial snapshot','Aprendizagem profissional'),
  protecao:m=>snapshotModule('suas',m,'MDS · Censo SUAS snapshot','Rede de proteção'),
  publicos:m=>snapshotModule('publicos',m,'IBGE/MDS snapshots','Públicos específicos'),
  condicoes:liveConditions,
  capacidade:m=>snapshotModule('capacidade',m,'IBGE MUNIC + Censo SUAS snapshot','Capacidade institucional'),
  orcamento:budget,
  recursos:resources,
  ecossistema:m=>snapshotModule('ecossistema',m,'CNEAS snapshot','Ecossistema social')
};
async function load(name,m,refresh=false){
  const fn=loaders[name];
  if(!fn)return result(name,'bad',null,'','Módulo inexistente.','');
  const key=name+':'+m.ibge,hit=cache.get(key);
  if(!refresh&&hit&&Date.now()-hit.at<TTL)return hit.value;
  let v;try{v=await fn(m)}catch(e){v=result(name,'bad',null,'',e?.message||'Falha no módulo.','')}
  cache.set(key,{at:Date.now(),value:v});return v;
}
function analysis(mods,m){
  const items=[],opportunities=[],cad=mods.vulnerabilidade?.data?.cadunico||{},app=mods.aprendizagem?.data||{},bud=mods.orcamento?.data||{},rec=mods.recursos?.data||{};
  if(finite(cad.families))items.push({theme:'Vulnerabilidade',text:'O Cadastro Único registra '+new Intl.NumberFormat('pt-BR').format(cad.families)+' famílias na referência disponível.'});
  if(finite(app.total||app.potential)){items.push({theme:'Aprendizagem',text:'O potencial municipal registrado é '+new Intl.NumberFormat('pt-BR').format(app.total||app.potential)+'.'});opportunities.push('aprendizagem profissional e preparação de jovens')}
  if(finite(bud.assist))items.push({theme:'Capacidade pública',text:'A despesa liquidada em Assistência Social é '+Number(bud.assist).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})+'.'});
  if(finite(rec.indicated))items.push({theme:'Recursos',text:'As transferências especiais identificadas somam '+Number(rec.indicated).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})+' em valores indicados.'});
  if(finite(cad.lowIncomeFamilies||cad.lowIncome))opportunities.push('inclusão produtiva e qualificação');
  return {headline:'Leitura integrada de '+m.nome+'/'+m.uf,items,opportunities:[...new Set(opportunities)],method:'Síntese construída somente com dados disponíveis; lacunas não são preenchidas por estimativas.'};
}
async function diagnosis(m,retry=false){
  const names=Object.keys(loaders);
  const arr=await Promise.all(names.map(async name=>{
    const old=cache.get(name+':'+m.ibge)?.value;
    const refresh=retry&&(!old||['bad','pending','partial'].includes(old.status));
    return load(name,m,refresh);
  }));
  const modules=Object.fromEntries(arr.map(x=>[x.name,x]));
  return {ok:true,version:'2.3.1',mode:'light-modular',municipio:{codigoIBGE:m.ibge,nome:m.nome,uf:m.uf},generatedAt:new Date().toISOString(),modules,analysis:analysis(modules,m)};
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type'});return res.end()}
    const u=new URL(req.url,'http://'+(req.headers.host||'localhost'));
    if(u.pathname==='/'||u.pathname==='/api/health')return send(res,200,{ok:true,service:'Diagnóstico Territorial Integrado · Rede Cidadã',version:'2.3.1',mode:'light-modular-auto',modules:Object.keys(loaders),time:new Date().toISOString()});
    let mth=u.pathname.match(/^\/api\/modulo\/([a-z-]+)\/(\d{7})$/);
    if(mth){
      const m=await municipality(mth[2],u.searchParams.get('nome')||'',u.searchParams.get('uf')||'');
      const r=await load(mth[1],m,u.searchParams.get('refresh')==='1');
      return send(res,200,{ok:r.status!=='bad',municipio:{codigoIBGE:m.ibge,nome:m.nome,uf:m.uf},...r});
    }
    mth=u.pathname.match(/^\/api\/diagnostico\/(\d{7})$/);
    if(mth){
      const m=await municipality(mth[1],u.searchParams.get('nome')||'',u.searchParams.get('uf')||'');
      return send(res,200,await diagnosis(m,u.searchParams.get('refresh')==='1'));
    }
    return send(res,404,{error:'Rota não encontrada'});
  }catch(e){return send(res,500,{error:'Falha interna',detail:e?.message||String(e)})}
});
server.listen(PORT,'0.0.0.0',()=>console.log('Diagnóstico Territorial v2 ativo na porta '+PORT));
