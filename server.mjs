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

const VIS_FAMILIAS_RENDA='https://aplicacoes.cidadania.gov.br/vis/data3/v.php?q%5B%5D=oNOclsLerpibuKep3bWChLNe09Gv17llja2AYWx7YmqqdH9%2BaWGEkWuXbWTZ6ayanbWUndqdiLSYmcrGbtCen9DgiG%2BiqaGt3nSIwayaes%2BS0J6gvKuEZJurlp60n666qpKSx5TWsJiYtrOVqLuadbSswrtam7bHlNecY5SrrGVweJSd2p2ItJiZysZu0J6f0OCIb6Kpoa3edIjBrJp6z5LQnqC8rIFkm6uWnrSfrrqqkpLHlNawmJi2s5Wou5p1tKzCu1qfvdGWyW5njdp%2Fa26Dm5vlrLKJnY7D1JileJm%2B58CZd4Oor%2BZcu62djsTAZptuksDcsW%2BiqaGt3nSzr6OgvJxu0J6f0OCIb6%2B9ol30WrC9mJm81JbPZXPL2rOVqaeYm91lfXdXWnfEosupmNDeslx8tpSg2qasgWhetsSUzmljhpzKb6Kpoa3edLOvo6C8nG7Qnp%2FQ4Ihvr72itsqurryrlrvCl89dp8zvrqBcrJpa35q6EeSZwMKmiqah0N6%2FnbCpqFrnqG2RmJG41KfcrFMgFbudn7dYi%2B6au8KgkbjFmIqhmH3hrqH%2F9aGj2qxts6RNysqn3572BD7wo1ysmlrescHAnJq4gaPZn6XC9a5Upbaoneuiwa%2BqTcXQU62el77uwaaraPjU56KwvVp%2BzMKh3qaXvt%2ByVKCtVaDaphD7o5a41FPPqlPQ5MGpnQvc%2FRyobbKcTcfQldyirb6btqKvq6ej7ZrAbqWcd6SUzp6m0e28VP%2Fio6PcqHCfrI7F1ZzOnpfCm7GZXK6WpzzmubeYoHfGoIqwnNHwrvfjC9ipmZ2ybqecudOY5J5ffe6ym7G2mamZmm20mJbPwlPOrFOt7bybrqmim5l7vLqqjnenlNcA4Mnkrl5oaJ6o7Jy%2Ft6uOyoGh2V12vt%2Bup7C6pFo807u3mpx6sqjLq6fG366YoWiZn5mfrrv62sPKlN1dl8Kbr5WlwJZa6567sphXgYGc2LCWz%2BTBla9oo6mZfK6ymKDL06KKAM3L5LCjX5mqm%2BettrKYkbyBl89dmb7oEOGosZatmZy8u1efvM%2BXy12jwu1tl524nq7aWbqzpaC4zVPLsfYGm7qZpbdVrdqlEO%2BplsaOoC3qocbovFRkmKSc657Hr1dYd6OU07WUfe2yoqCpXlrip8CxqZbLwqaKq6J9vq6YnbuprOhZEOillrrQVruylMvvtpidrJpa3Z5ttJiaGg6f056mfd68oVy6mqjdmm2%2BnJ93xJTapqe%2Bm7qZqruWppmasLekjnfFmIqqmMbqbaedtPjb66K8e6TwBM%2Bc16xdh6Vtnaq7mKzira7BV5vGgXbLoZTQ77%2BjXAvPqOKcvMqnaNPdr5xtZZCofWdpeGaOqWmHfmdnh5GNpQ%3D%3D';
const VIS_BOLSA_FAMILIA='https://aplicacoes.cidadania.gov.br/vis/data3/v.php?q%5B%5D=oNOclsLerpibuKep3bV%2Bgmxl05Kv2rmg2a19ZW51ZmymaX6JaV2JlmCbb2CNrMmlsKyamembs61ojMfGpt2slLysiJqdtKiftJ%2BuuqqSkpyZy6mmwraIp7G1WKvtnbKtp4%2B9wGTJrZjQ7ryVm3pwoNqlwLNyk7jNps94bsPcuaehg3Ct7qZwv6uRvMCjzKOSjtq9ma%2B7pJvYbIi0mJnKxm7Qnp%2FQ4Ihvoqmhrd50iMGsmnrSp86iks3ds5Ntp6Wf7Ky8r5ZhkseU1rCYmOGuoK%2BtcHXfmrnBnGiS1KjXYKTR37KTrKqbmaqYvbOqoMbCkp94mb7nwJl3rpam7J6IiZ2Ow9SYpXim0uhwpbCsmpnpm7OtaIzHxqbdrJS8sYianbSon7SfrrqqkpKcmcuppsK2iKextVir7Z2yraePvcBkya2Y0O68lZt%2FcKDapcCzcpO4zabPeG7D3LmnoYNwre6mcL%2BrkbzAo8yjko7avZmvu6Sb2Kaut6qMjpyZy6mmwrazlai7mnW0n666qpKSnKbfqq%2Bu8K6isLGZm92ebbKcTb3CoC3qn8bcwFSeraOf36Kwt%2FrOycqU3V2XzJudpquvp5vmmm2QppnKwlOwnqAgKLmdnWibqeumrrKYTcfQpYpuU8bpwZmjupao7Z5tfVeixcqjz7CmzNy2p1%2BZqpvnrbaymJG8gZfPXZm%2B6BDhqLGWrZmbsryck8DEnC3epcbcwFSgt1WK66i0wJiauIF12ammvpuTlakL4qbimm20pp%2FEwpfLXaPM7W1mXLGjrt6gv6%2BlobzUVruylMvvtpidrJpa3Z5ttJiaGg6f056mfd2yoqGunp3i%2FO7AoI7KgZfZXYPP6rSmnbWWWruoucGYTZ3CoC3qn8bcbZqruqKb3Zptvqafd5RT06unwuK%2Flaq8mq2cisKvpaHAxZTOolPB4G2anbX45%2BWirsFXj7zPmNCmlsY%2B7qalqaha3ahtnqmcvtOU155Tn%2Bq5p51oe5vm%2FPq6oI53x6LcqpTB3G2kq7pVbpmiu8KclMnCod6ipoDMwpWqvJ6e2p2ybpuSd8eU1wDgyeSup1yqmqjen7axoPD405zLsFPB6m2ErrecrNqmrm55nMPUlIqDlMo%2B%2BqClqVWg6Ku6r5uOd9Gi3F1ofeS7qKGvp5vnrbLBWn7MwqHeppe%2B37JUoK1VoNqmEPujlrjUU8yiocLhtpelC9as4prAbpucd7Gl2aSlvuiuVH63oa3aWZOvpPAEzZzLXZnM7bqVoKlVquirbYRXlsXVmNGvlMvvsqdfmaqb5622spiRvIGXz12ZvugQ4aixlq2Zm7K8nJPAxJwt3qXG3MBUoLdViuuotMCYmriBddmppr6bk5WpC%2BKm4ppttKafxMKXy12jzO1ta1yxo67eoL%2BvpaG81Fa7spTL77aYnayaWt2ebbSYmhoOn9Oepn3dsqKhrp6d4vzuwKCOyoGX2V2Dz%2Bq0pp21llq7qLnBmE2dwqAt6p%2FG3G2aq7qim92abb6mn3eZU9myU8rctqdcsaOu3qC%2Fr6WhvNSv2niv2feI';
const VIS_PCD_CADUNICO='https://aplicacoes.cidadania.gov.br/vis/data3/v.php?q%5B%5D=oNOclsLerpibuKep3bWEgLNe09Gv17lljax%2FYWyAYmqqdH9%2BaWKEkWaXbWTZ6aykobuomd2es7ealrzPks2el5jhrqCvrXCg2qXAs3JovcKf3aJumO7CoV%2B2lKrerMCtm5K9ypbToqG87rKhrq2oqticrrJyk7jNps94mb7nwJl3g5ub5ayyiXKgzM6vu7KUy%2B%2B2mJ2smlrdnm2%2BnKDK0JTdXZbM6G2Yoa6eneL897yalriBnNiwls%2FkwZWvaKOpmXyuspigy9OiigDNy%2BSwo1%2BYmq3sqK7BV5DGzlPNnqDN6m2YoWient6nwbedlrrC9hEA1sybsZmisZijPOO7saCOd9SY112lwu69o6%2B8lrbpdMnKs2g%3D';
const VIS_BPC='https://aplicacoes.cidadania.gov.br/vis/data3/v.php?vsc=PYfnoX';
const CECAD_MAIN='https://cecad.cidadania.gov.br/painel03.php';
const CECAD_SERIES='https://cecad.cidadania.gov.br/agregado/resumovariavelCecad.php';
const VIS_BPC_CADUNICO='https://aplicacoes.cidadania.gov.br/vis/data3/v.php?q%5B%5D=oNOhlMHqwJOsuqSe9XGEymipx92g5m9jjrR6ZG11ZWu0a32AbFqIkmCabq%2FTtIBnd66WpuyeiLSYmcrGbqWjlMnusm93u6qnnK%2BGgWtovcKf3aJuw9y5p6GDcKDapcCzcmjK1qCNs2yQsIianbSon7SfrrqqkpKcmcuppsK2iKextbF83qeytKCQwCTU3Kai0JuPhH9oo6mZfK6ymKDL06KKAM3L5LCjX4qaqN6ftrGg8PjTnNmwU5%2FLkFSqt1V92p2uwaufxoH2BKucwOptYVyYeH6ce7K8nJPAxJwt3qXG6sBUfph4WueobZGYkbjUp9ysUyAVu52ft1VnmYKxvaqc09Fu5rmvmA%3D%3D';

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
async function request(url,ms=12000,extraHeaders={}){
  const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),ms);
  try{
    const r=await fetch(url,{signal:ctrl.signal,headers:{'user-agent':'RedeCidada-Diagnostico/2.0','accept':'application/json,*/*',...extraHeaders}});
    if(!r.ok)throw new Error(String(r.status)+' '+r.statusText);
    return r;
  }finally{clearTimeout(t)}
}
const fetchJson=async(url,ms=12000)=>(await request(url,ms)).json();
const fetchText=async(url,ms=10000)=>(await request(url,ms)).text();
const fetchBrowserText=async(url,ms=12000)=>(await request(url,ms,{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36','accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','accept-language':'pt-BR,pt;q=0.9,en;q=0.7','referer':'https://cecad.cidadania.gov.br/'})).text();
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
async function observatorioSnapshot(m){
  try{
    if(!m.uf)return null;
    const raw=await readFile(path.join(SNAP,'observatorio',String(m.uf).toUpperCase()+'.json'),'utf8');
    const all=JSON.parse(raw);
    return all?.[String(m.ibge)]??null;
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

function visMunicipalUrl(base,m){
  const u=new URL(base);
  u.searchParams.set('ag','m');
  u.searchParams.set('codigo',String(m.ibge).slice(0,6));
  return u.toString();
}
function visNum(v){
  let s=String(v??'').trim();
  if(!s||s==='-'||s==='—')return NaN;
  s=s.replace(/R\$\s*/g,'').replace(/\s+/g,'');
  if(/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s))s=s.replace(/\./g,'').replace(',','.');
  else if(/^[-+]?\d+(,\d+)$/.test(s))s=s.replace(',','.');
  else s=s.replace(/[^0-9.\-]/g,'');
  const n=Number(s);return Number.isFinite(n)?n:NaN;
}
function visTableMetrics(html){
  const out=[],text=String(html||'');
  for(const tm of text.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)){
    const idx=tm.index||0;
    const context=clean(stripHtml(text.slice(Math.max(0,idx-1400),idx)).slice(-900));
    const rows=[];
    for(const rm of tm[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[...rm[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>stripHtml(x[1]));
      if(cells.length)rows.push(cells);
    }
    const latest=latestVisRowFromRows(rows,1);
    if(latest)out.push({context,...latest});
  }
  return out;
}
function latestVisRowFromRows(rows,minValues=1){
  const found=[];
  for(const row of rows||[]){
    const pi=row.findIndex(x=>periodCell(x));
    if(pi<0)continue;
    const p=periodCell(row[pi]),values=[];
    for(let i=pi+1;i<row.length;i++){const v=visNum(row[i]);if(Number.isFinite(v))values.push(Number(v))}
    if(values.length>=minValues)found.push({...p,values,row});
  }
  found.sort((a,b)=>b.key-a.key || b.values.length-a.values.length);
  return found[0]||null;
}
function latestVisRow(html,minValues=1){
  const found=[];
  for(const rows of htmlTables(html)){
    for(const row of rows){
      const pi=row.findIndex(x=>periodCell(x));
      if(pi<0)continue;
      const p=periodCell(row[pi]);
      const values=[];
      for(let i=pi+1;i<row.length;i++){
        const v=visNum(row[i]);
        if(Number.isFinite(v))values.push(Number(v));
      }
      if(values.length>=minValues)found.push({...p,values,row});
    }
  }
  found.sort((a,b)=>b.key-a.key || b.values.length-a.values.length);
  return found[0]||null;
}
async function visMunicipalLatest(base,m,minValues=1,timeout=10000){
  try{
    const html=await fetchText(visMunicipalUrl(base,m),timeout);
    return latestVisRow(html,minValues);
  }catch{return null}
}
async function visMunicipalMetrics(base,m,timeout=10000){
  try{return visTableMetrics(await fetchText(visMunicipalUrl(base,m),timeout))}catch{return []}
}
function visMetric(metrics,rx){
  const cands=(metrics||[]).filter(x=>rx.test(x.context));
  cands.sort((a,b)=>b.context.lastIndexOf((b.context.match(rx)||[''])[0])-a.context.lastIndexOf((a.context.match(rx)||[''])[0]));
  return cands[0]?.values?.[0]??null;
}

function latestSeries(rows){const found=[];for(const row of rows||[]){const pi=row.findIndex(x=>periodCell(x));if(pi<0)continue;const p=periodCell(row[pi]);let value=NaN;for(let i=pi+1;i<row.length;i++){const v=num(row[i]);if(finite(v)){value=Number(v);break}}if(finite(value))found.push({...p,value})}found.sort((a,b)=>b.key-a.key);return found[0]||null}
async function ibgeExactCategoryPercent(table,m,labels){
  try{
    const meta=await ibgeMeta(table);
    const wanted=(Array.isArray(labels)?labels:[labels]).map(clean);
    const cls=(meta?.classificacoes||[]).find(x=>(x.categorias||[]).some(a=>wanted.includes(clean(a.nome))));
    if(!cls)return null;
    const target=(cls.categorias||[]).find(a=>wanted.includes(clean(a.nome)));
    if(!target)return null;
    const cq=(meta.classificacoes||[]).map(x=>x.id+'['+(x.id===cls.id?target.id:totalCategory(x))+']').join('|');
    const rows=aggFlat(await ibgeData(table,2022,'all',m,cq)).filter(x=>finite(x.value));
    const pct=rows.find(x=>clean(x.variable).includes('percentual')&&(x.labels||[]).some(a=>clean(a)===clean(target.nome)));
    if(pct&&Number(pct.value)>=0&&Number(pct.value)<=100)return Number(pct.value);
    const abs=rows.find(x=>!clean(x.variable).includes('percentual')&&(x.labels||[]).some(a=>clean(a)===clean(target.nome)));
    if(abs){
      const cqTotal=(meta.classificacoes||[]).map(x=>x.id+'['+totalCategory(x)+']').join('|');
      const totalRows=aggFlat(await ibgeData(table,2022,'all',m,cqTotal)).filter(x=>finite(x.value)&&!clean(x.variable).includes('percentual'));
      const total=totalRows.find(x=>String(x.variableId)===String(abs.variableId))||totalRows[0];
      if(total&&Number(total.value)>0){
        const v=100*Number(abs.value)/Number(total.value);
        if(v>=0&&v<=100)return v;
      }
    }
    return null;
  }catch{return null}
}
async function ibgeHousingBasics(m){
  const out={};
  try{
    const rows=aggFlat(await ibgeData(4712,2022,'all',m)).filter(x=>finite(x.value));
    const households=rows.find(x=>clean(x.variable)==='domicilios particulares permanentes ocupados');
    const avg=rows.find(x=>clean(x.variable).includes('media de moradores em domicilios particulares permanentes ocupados'));
    const residents=rows.find(x=>clean(x.variable)==='moradores em domicilios particulares permanentes ocupados');
    if(households)out.households=Number(households.value);
    if(avg)out.avgResidents=Number(avg.value);
    if(residents)out.householdResidents=Number(residents.value);
  }catch{}
  return out;
}
async function liveConditions(m){
  const snap=await snapshot('condicoes',m.ibge);const out=snap?{...snap}:{};
  const basics=await ibgeHousingBasics(m);
  if(!finite(out.households)&&finite(basics.households))out.households=basics.households;
  if(!finite(out.avgResidents)&&finite(basics.avgResidents))out.avgResidents=basics.avgResidents;
  if(!finite(out.householdResidents)&&finite(basics.householdResidents))out.householdResidents=basics.householdResidents;
  if(!finite(out.waterPercent))out.waterPercent=await ibgeExactCategoryPercent(6803,m,['Possui ligação à rede geral e a utiliza como forma principal']);
  if(!finite(out.sewerPercent))out.sewerPercent=await ibgeExactCategoryPercent(6805,m,['Rede geral, rede pluvial ou fossa ligada à rede']);
  if(!finite(out.wastePercent))out.wastePercent=await ibgeExactCategoryPercent(6892,m,['Coletado']);
  for(const k of ['waterPercent','sewerPercent','wastePercent']){
    if(finite(out[k])&&(Number(out[k])<0||Number(out[k])>100))out[k]=null;
  }
  const ok=[out.households,out.avgResidents,out.waterPercent,out.sewerPercent,out.wastePercent,out.apsCoverage,out.ubs,out.caps].some(finite);
  return ok?result('condicoes',snap?'ok':'partial',out,snap?'IBGE + SINISA + SUS snapshot':'IBGE · Censo 2022','Estatísticas domiciliares carregadas automaticamente; saúde e SINISA entram quando o snapshot estiver disponível.',out.reference||'Censo 2022'):result('condicoes','bad',null,'IBGE + SINISA + SUS','Condições de vida não responderam nesta consulta.','');
}
function htmlTagValues(block,tag='h5'){
  return [...String(block||'').matchAll(new RegExp('<'+tag+'\\b[^>]*>([\\s\\S]*?)<\\/'+tag+'>','gi'))]
    .map(x=>stripHtml(x[1]))
    .map(visNum)
    .filter(Number.isFinite);
}
function cecadBlocks(html){
  const hits=[...String(html||'').matchAll(/<div\b[^>]*id=["'](dados-cadastro-[^"']+)["'][^>]*>/gi)],out=[];
  for(let i=0;i<hits.length;i++){
    const start=(hits[i].index||0),end=i+1<hits.length?(hits[i+1].index||html.length):html.length;
    const raw=html.slice(start,end),text=stripHtml(raw),values=htmlTagValues(raw,'h5');
    out.push({id:hits[i][1],text,clean:clean(text),values});
  }
  return out;
}
function cecadMetric(blocks,rx,index=0){
  const b=(blocks||[]).find(x=>rx.test(x.clean));
  return b&&Number.isFinite(b.values?.[index])?Number(b.values[index]):null;
}
function cecadReference(blocks){
  for(const b of blocks||[]){const m=String(b.text||'').match(/(0?[1-9]|1[0-2])\/(20\d{2})/);if(m)return String(m[1]).padStart(2,'0')+'/'+m[2]}
  return '';
}
async function cecadSummary(m){
  try{
    const base=new URL(CECAD_MAIN);
    base.searchParams.set('oik','1');
    base.searchParams.set('p_ibge',String(m.ibge).slice(0,6));

    const uCad=new URL(base.toString());
    uCad.searchParams.set('p_escopo','2');
    const cadHtml=await fetchBrowserText(uCad.toString(),15000);
    const cadText=stripHtml(cadHtml);
    const blocks=cecadBlocks(cadHtml);
    const out={source:'MDS · CECAD 2.0',reference:cecadReference(blocks)};

    const after=(rx,span=260)=>{
      const mm=cadText.match(rx); if(!mm)return null;
      const tail=cadText.slice((mm.index||0)+mm[0].length,(mm.index||0)+mm[0].length+span);
      const nv=tail.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?![\d])/);
      return nv?safe(visNum(nv[1])):null;
    };

    out.families=after(/Fam[ií]lias\s+Cadastradas/i) ?? safe(cecadMetric(blocks,/familias cadastradas(?!.*pobreza|.*baixa renda)/));
    out.povertyFamilies=after(/Fam[ií]lias\s+em\s+situa[cç][aã]o\s+de\s+Pobreza/i) ?? safe(cecadMetric(blocks,/situacao de pobreza/));
    out.lowIncomeFamilies=after(/Fam[ií]lias\s+de\s+Baixa\s+Renda/i) ?? safe(cecadMetric(blocks,/baixa renda/));
    out.aboveHalfFamilies=after(/Fam[ií]lias\s+Acima\s+de\s+[½1\/2]+\s*Sal\.?\s*Min/i) ?? safe(cecadMetric(blocks,/acima de (?:1\/2|meio).*salario/));
    out.updatedFamilies=after(/Total\s+de\s+Fam[ií]lias\s+Atualizadas/i);

    if(finite(out.povertyFamilies)&&finite(out.lowIncomeFamilies))
      out.upToHalfMinimumWageFamilies=safe(Number(out.povertyFamilies)+Number(out.lowIncomeFamilies));

    try{
      const uPbf=new URL(base.toString());
      uPbf.searchParams.set('p_escopo','3');
      const pbfText=stripHtml(await fetchBrowserText(uPbf.toString(),15000));
      const mm=pbfText.match(/Fam[ií]lias\s+Benefici[aá]rias/i);
      if(mm){
        const tail=pbfText.slice((mm.index||0)+mm[0].length,(mm.index||0)+mm[0].length+220);
        const nv=tail.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?![\d])/);
        if(nv)out.bolsaFamiliaFamilies=safe(visNum(nv[1]));
        const rr=tail.match(/(0?[1-9]|1[0-2])\/(20\d{2})/);
        if(rr)out.bolsaFamiliaReference=String(rr[1]).padStart(2,'0')+'/'+rr[2];
      }
    }catch{}

    return [out.families,out.povertyFamilies,out.lowIncomeFamilies,out.aboveHalfFamilies,out.updatedFamilies,out.bolsaFamiliaFamilies].some(finite)?out:null;
  }catch{return null}
}
async function cecadPbf(m){
  try{
    const u=new URL(CECAD_SERIES);
    u.searchParams.set('id','79');
    u.searchParams.set('p_ibge',String(m.ibge));
    u.searchParams.set('uf_ibge',String(m.ibge).slice(0,2));
    const html=await fetchBrowserText(u.toString(),12000),row=latestVisRow(html,1);
    if(!row)return null;
    return {families:safe(row.values[0]),reference:String(row.month).padStart(2,'0')+'/'+row.year};
  }catch{return null}
}
async function cecadSeries(id,m){
  try{
    const u=new URL(CECAD_SERIES);
    u.searchParams.set('id',String(id));
    u.searchParams.set('p_ibge',String(m.ibge));
    u.searchParams.set('uf_ibge',String(m.ibge).slice(0,2));
    const html=await fetchBrowserText(u.toString(),12000),row=latestVisRow(html,1);
    if(!row)return null;
    return {value:safe(row.values[0]),reference:String(row.month).padStart(2,'0')+'/'+row.year};
  }catch{return null}
}
async function cecadBpc(m){
  try{
    const u=new URL('https://cecad.cidadania.gov.br/agregado/resumovariavel_3a.php');
    u.searchParams.set('cabeca','140');
    u.searchParams.append('id[]','34');
    u.searchParams.append('id[]','135');
    u.searchParams.set('p_ibge',String(m.ibge));
    u.searchParams.set('uf_ibge',String(m.ibge).slice(0,2));
    const html=await fetchBrowserText(u.toString(),15000);
    const row=latestVisRow(html,2);
    if(!row||row.values.length<2)return null;
    const pcd=safe(row.values[0]),elderly=safe(row.values[1]);
    const total=(finite(pcd)||finite(elderly))?safe((Number(pcd)||0)+(Number(elderly)||0)):null;
    return {
      total,
      pcd,
      elderly,
      reference:String(row.month).padStart(2,'0')+'/'+row.year,
      source:'MDS · CECAD 2.0',
      basis:'beneficiários do BPC por município · PcD + idosos'
    };
  }catch{return null}
}
async function liveDisability(m){
  try{
    const meta=await ibgeMeta(10131);
    const d=await ibgeData(10131,2022,'all',m,classQuery(meta,[/existencia de deficiencia/]));
    const rows=aggFlat(d).filter(x=>finite(x.value)&&!clean(x.variable).includes('percentual'));
    const hit=rows.find(x=>(x.labels||[]).some(a=>clean(a)==='pessoa com deficiencia'||clean(a)==='pessoas com deficiencia'));
    return hit?Number(hit.value):null;
  }catch{return null}
}
async function liveCadunico(m){
  const [snap,benefits,cecad,pbf,bpcDirect,bpcMetrics,pcdCensus,obs,street,extreme,povertySeries,lowSeries,aboveSeries,updated]=await Promise.all([
    snapshot('cadunico',m.ibge),
    snapshot('beneficios_sociais',m.ibge),
    cecadSummary(m),
    cecadPbf(m),
    cecadBpc(m),
    visMunicipalMetrics(VIS_BPC_CADUNICO,m,12000),
    liveDisability(m),
    observatorioSnapshot(m),
    cecadSeries(44,m),
    cecadSeries(208,m),
    cecadSeries(209,m),
    cecadSeries(210,m),
    cecadSeries(211,m),
    cecadSeries(81,m)
  ]);
  const out={...(snap||{}),source:'MDS · CECAD 2.0 + dados abertos CGU + IBGE Censo 2022',notes:Array.isArray(snap?.notes)?[...snap.notes]:[]};

  if(cecad){
    Object.assign(out,cecad);
    if(finite(out.families)&&finite(out.povertyFamilies)&&finite(out.lowIncomeFamilies)&&!finite(out.upToHalfMinimumWageFamilies))
      out.upToHalfMinimumWageFamilies=safe(Number(out.povertyFamilies)+Number(out.lowIncomeFamilies));
  }
  if(extreme&&finite(extreme.value)){out.extremePovertyFamilies=extreme.value;out.extremePovertyReference=extreme.reference}
  if(povertySeries&&finite(povertySeries.value)){out.povertyFamilies=povertySeries.value;out.povertyReference=povertySeries.reference}
  if(lowSeries&&finite(lowSeries.value)){out.lowIncomeFamilies=lowSeries.value;out.lowIncomeReference=lowSeries.reference}
  if(aboveSeries&&finite(aboveSeries.value)){out.aboveHalfFamilies=aboveSeries.value;out.aboveHalfReference=aboveSeries.reference}
  if(street&&finite(street.value)){out.streetFamilies=street.value;out.streetReference=street.reference}
  if(updated&&finite(updated.value)&&!finite(out.updatedFamilies)){out.updatedFamilies=updated.value;out.updatedReference=updated.reference}
  if(finite(out.povertyFamilies)&&finite(out.lowIncomeFamilies))out.upToHalfMinimumWageFamilies=safe(Number(out.povertyFamilies)+Number(out.lowIncomeFamilies));

  if(obs){
    out.observatorioAvailable=true;
    out.observatorioReference=obs.reference||'painel público';
    for(const k of ['families','bolsaFamiliaFamilies','bpcTotal','povertyFamilies']){
      if(!finite(out[k])&&finite(obs[k]))out[k]=safe(obs[k]);
    }
    if(finite(obs.pcdFamilies))out.pcdCadunicoFamilies=safe(obs.pcdFamilies);
    if(finite(obs.singlePersonFamilies))out.singlePersonFamilies=safe(obs.singlePersonFamilies);
    if(finite(obs.streetFamilies))out.streetFamilies=safe(obs.streetFamilies);
    if(finite(obs.gpteFamilies))out.gpteFamilies=safe(obs.gpteFamilies);
    if(finite(obs.updatedFamilies))out.updatedFamilies=safe(obs.updatedFamilies);
  }

  if(pbf&&!finite(out.bolsaFamiliaFamilies)){
    out.bolsaFamiliaFamilies=safe(pbf.families);
    out.bolsaFamiliaReference=pbf.reference;
  }

  if(benefits){
    if(!finite(out.bpcTotal)&&finite(benefits.bpcTotal)){
      out.bpcTotal=safe(benefits.bpcTotal);
      out.bpcReference=benefits.bpcReference||out.bpcReference||'';
      out.bpcBasis=benefits.bpcBasis||'benefícios BPC pagos no município do beneficiário';
      out.bpcSource=benefits.bpcSource||'CGU · Portal da Transparência';
    }
    if(!finite(out.bolsaFamiliaFamilies)&&finite(benefits.bolsaFamiliaPaidRecipients)){
      out.bolsaFamiliaPaidRecipients=safe(benefits.bolsaFamiliaPaidRecipients);
      out.bolsaFamiliaPaidRecipientsReference=benefits.bolsaFamiliaPaidRecipientsReference||'';
      out.bolsaFamiliaPaidRecipientsSource=benefits.bolsaFamiliaPaidRecipientsSource||'CGU · Portal da Transparência';
      out.notes.push('Bolsa Família exibido como responsáveis/beneficiários pagos quando a contagem oficial de famílias do CECAD não estiver disponível.');
    }
  }

  if(bpcDirect&&finite(bpcDirect.total)){
    out.bpcTotal=safe(bpcDirect.total);
    out.bpcPcd=safe(bpcDirect.pcd);
    out.bpcElderly=safe(bpcDirect.elderly);
    out.bpcReference=bpcDirect.reference||'';
    out.bpcBasis=bpcDirect.basis;
    out.bpcSource=bpcDirect.source;
  }else if(Array.isArray(bpcMetrics)&&bpcMetrics.length){
    out.bpcTotal=safe(visMetric(bpcMetrics,/beneficiarios bpc no cadastro unico(?!.*pcd|.*idoso)/));
    out.bpcPcd=safe(visMetric(bpcMetrics,/beneficiarios bpc no cadastro unico.*pcd/));
    out.bpcElderly=safe(visMetric(bpcMetrics,/beneficiarios bpc no cadastro unico.*idoso/));
    const latest=bpcMetrics.slice().sort((a,b)=>b.key-a.key)[0];
    if(latest)out.bpcReference=String(latest.month).padStart(2,'0')+'/'+latest.year;
    out.bpcBasis='beneficiários do BPC inscritos no Cadastro Único';
    out.bpcSource='MDS · VIS DATA';
  }

  if(finite(pcdCensus)){
    out.pcdPeople=safe(pcdCensus);
    out.pcdReference='Censo 2022';
    out.pcdBasis='IBGE · pessoas de 2 anos ou mais com deficiência';
  }

  if(!finite(out.extremePovertyFamilies)){
    out.extremePovertyFamilies=null;
    out.notes.push('Extrema pobreza indisponível nesta consulta; o campo permanece n/d.');
  }
  out.mapaSocialUrl='https://mapa-social.mds.gov.br/';
  const useful=[out.families,out.povertyFamilies,out.lowIncomeFamilies,out.bolsaFamiliaFamilies,out.bolsaFamiliaPaidRecipients,out.pcdPeople,out.bpcTotal].some(finite);
  return useful?out:null;
}
async function liveVulnerability(m){
  const cad=await liveCadunico(m);
  if(cad){
    const complete=[cad.families,cad.bolsaFamiliaFamilies??cad.bolsaFamiliaPaidRecipients,cad.pcdPeople,cad.bpcTotal,cad.povertyFamilies,cad.lowIncomeFamilies].filter(finite).length;
    return result('vulnerabilidade',complete>=5?'ok':'partial',{cadunico:cad},'MDS · Cadastro Único / Bolsa Família / BPC','Indicadores sociais consultados automaticamente em fontes agregadas do MDS.',cad.reference||cad.bolsaFamiliaReference||cad.bpcReference||'');
  }
  return result('vulnerabilidade','bad',{cadunico:null},'MDS · Cadastro Único / Bolsa Família / BPC','As consultas agregadas do MDS não responderam nesta tentativa.','');
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
  return {ok:true,version:'2.12.0',mode:'light-modular',municipio:{codigoIBGE:m.ibge,nome:m.nome,uf:m.uf},generatedAt:new Date().toISOString(),modules,analysis:analysis(modules,m)};
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type'});return res.end()}
    const u=new URL(req.url,'http://'+(req.headers.host||'localhost'));
    if(u.pathname==='/'||u.pathname==='/api/health')return send(res,200,{ok:true,service:'Diagnóstico Territorial Integrado · Rede Cidadã',version:'2.12.0',mode:'light-modular-auto',modules:Object.keys(loaders),time:new Date().toISOString()});
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
