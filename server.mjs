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
  perfil:m=>snapshotModule('perfil',m,'IBGE · Censo/SIDRA snapshot','Perfil territorial'),
  vulnerabilidade:async m=>{
    const cad=await snapshot('cadunico',m.ibge),iv=await snapshot('ivcad',m.ibge);
    if(cad||iv)return result('vulnerabilidade',cad?'ok':'partial',{cadunico:cad||null,ivcad:iv||null},'MDS · Cadastro Único / IVCAD snapshots',cad?'Base social municipal carregada.':'IVCAD disponível sem Cadastro Único.',cad?.reference||iv?.reference||'');
    return result('vulnerabilidade','pending',{cadunico:null,ivcad:null},'MDS · Cadastro Único / IVCAD','Snapshot social ainda não carregado. IVCAD não bloqueia o diagnóstico.','');
  },
  educacao:m=>snapshotModule('educacao',m,'INEP + IBGE snapshot','Educação'),
  trabalho:m=>snapshotModule('trabalho',m,'MTE · RAIS/Novo Caged snapshot','Trabalho e renda'),
  aprendizagem:m=>snapshotModule('aprendizagem',m,'MTE/SIT · eSocial snapshot','Aprendizagem profissional'),
  protecao:m=>snapshotModule('suas',m,'MDS · Censo SUAS snapshot','Rede de proteção'),
  publicos:m=>snapshotModule('publicos',m,'IBGE/MDS snapshots','Públicos específicos'),
  condicoes:m=>snapshotModule('condicoes',m,'IBGE + SINISA + SUS snapshots','Condições de vida e saúde'),
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
  return {ok:true,version:'2.0.0',mode:'light-modular',municipio:{codigoIBGE:m.ibge,nome:m.nome,uf:m.uf},generatedAt:new Date().toISOString(),modules,analysis:analysis(modules,m)};
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type'});return res.end()}
    const u=new URL(req.url,'http://'+(req.headers.host||'localhost'));
    if(u.pathname==='/'||u.pathname==='/api/health')return send(res,200,{ok:true,service:'Diagnóstico Territorial Integrado · Rede Cidadã',version:'2.0.0',mode:'light-modular',modules:Object.keys(loaders),time:new Date().toISOString()});
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
