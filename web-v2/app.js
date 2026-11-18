'use strict';
const qs = s=>document.querySelector(s);
const state={selected:null,data:null,analysis:null,searchController:null};
const nf=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
const curr=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
const idToLabel={'verificado':'Verificado','nao_integrado':'Não integrado','indisponivel':'Indisponível'};
function status(text,problem=false){const e=qs('#globalNotice');e.querySelector('span:last-child').textContent=text;e.style.background=problem?'#fff4e6':'#e9f2ff';}
function fmt(ind){if(!ind||ind.value===null)return '—';if(ind.unit==='R$')return curr.format(ind.value);return nf.format(ind.value)+(ind.unit==='pessoas'?'':ind.unit==='km²'?' km²':ind.unit==='hab./km²'?' hab./km²':'');}
function enableReady(on){qs('#analysisBtn').disabled=!on;qs('#pdfTop').disabled=!on;qs('#pdfBottom').disabled=!on;}
function select(m){
  state.selected=m;state.data=null;state.analysis=null;
  qs('#citySearch').value=m.nome+' / '+m.uf;
  qs('#suggestions').hidden=true;
  qs('#loadBtn').disabled=false;
  qs('#territoryCaption').textContent='Território selecionado: '+m.nome+' / '+m.uf+' · Código IBGE '+m.codigoIBGE+'. Clique em Gerar diagnóstico.';
  enableReady(false);
}
let searchTimer;
qs('#citySearch').addEventListener('input',e=>{
  state.selected=null;qs('#loadBtn').disabled=true;enableReady(false);
  const q=e.target.value.trim();clearTimeout(searchTimer);
  if(q.length<2){qs('#suggestions').hidden=true;return;}
  searchTimer=setTimeout(async()=>{
    if(state.searchController)state.searchController.abort();
    state.searchController=new AbortController();
    const host=qs('#suggestions');host.hidden=false;host.replaceChildren();
    const loading=document.createElement('div');loading.className='empty';loading.textContent='Consultando municípios do IBGE...';host.append(loading);
    try{
      const r=await fetch('/api/municipios?q='+encodeURIComponent(q),{signal:state.searchController.signal});
      if(!r.ok)throw new Error('A fonte de municípios não respondeu.');
      const d=await r.json();host.replaceChildren();
      if(!(d.items||[]).length){const empty=document.createElement('div');empty.className='empty';empty.textContent='Nenhum município correspondente.';host.append(empty);return;}
      for(const m of d.items){
        const button=document.createElement('button');button.type='button';
        const label=document.createElement('strong');label.textContent=m.nome+' / '+m.uf;
        const sub=document.createElement('small');sub.textContent='Código IBGE: '+m.codigoIBGE;
        button.append(label,sub);button.onclick=()=>select(m);host.append(button);
      }
    }catch(err){if(err.name!=='AbortError'){host.replaceChildren();const p=document.createElement('div');p.className='empty';p.textContent='Consulta indisponível. Use uma das consultas rápidas ou tente novamente.';host.append(p);}}
  },350);
});
document.addEventListener('click',e=>{if(!e.target.closest('.search-box'))qs('#suggestions').hidden=true;});
document.querySelectorAll('.sample-city').forEach(el=>el.addEventListener('click',()=>select({codigoIBGE:el.dataset.ibge,nome:el.dataset.city,uf:el.dataset.uf})));
qs('#loadBtn').onclick=async()=>{
 if(!state.selected)return;
 const button=qs('#loadBtn');button.disabled=true;button.textContent='Consultando fontes...';
 status('Buscando indicadores oficiais para '+state.selected.nome+' e verificando a qualidade das respostas.');
 try{
  const r=await fetch('/api/diagnostico?ibge='+encodeURIComponent(state.selected.codigoIBGE),{cache:'no-store'});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Não foi possível validar as fontes.');
  if(d.municipio.codigoIBGE!==state.selected.codigoIBGE)throw new Error('O município retornado não corresponde à seleção.');
  state.data=d;state.analysis=null;render(d);enableReady(true);
  status('Consulta concluída. '+d.quality.verified+' de '+d.quality.total+' indicadores demonstrativos verificados. Consulte as lacunas antes de decidir.');
  document.getElementById('indicadores').scrollIntoView({behavior:'smooth'});
 }catch(err){status(err.message,true)}
 finally{button.disabled=false;button.textContent='Gerar diagnóstico ↗';}
};
function set(id,value){qs(id).textContent=value;}
function render(d){
 const get=id=>d.indicators.find(x=>x.id===id);
 set('#kpiCensus',fmt(get('populacao_censo')));
 set('#kpiEstimate',fmt(get('populacao_estimativa')));
 set('#kpiArea',fmt(get('area')));
 set('#kpiAssist',fmt(get('orcamento_assistencia')));
 set('#metaEstimate','IBGE · '+(get('populacao_estimativa')?.period||'Competência indisponível'));
 set('#metaAssist','SICONFI · '+(get('orcamento_assistencia')?.period||'Sem competência válida'));
 set('#territoryCaption',d.municipio.nome+' / '+d.municipio.uf+' · Código IBGE '+d.municipio.codigoIBGE+' · fontes oficiais e transparência metodológica.');
 set('#lastUpdated','CONSULTADO EM '+new Date(d.generatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}));
 const list=qs('#indicatorList');list.replaceChildren();
 for(const ind of d.indicators){
  const line=document.createElement('div');line.className='indicator-line '+(ind.status==='verificado'?'':'unavailable');
  const left=document.createElement('div');const b=document.createElement('b');b.textContent=ind.label;
  const sm=document.createElement('small');sm.textContent=(d.sources[ind.source]?.name||'Fonte não cadastrada')+' · '+ind.period;
  left.append(b,sm);const val=document.createElement('strong');val.textContent=ind.status==='verificado'?fmt(ind):'Indisponível';line.append(left,val);list.append(line);
 }
 set('#indicatorCount',d.quality.verified+' verificados');
 set('#qualityTag',d.quality.verified+' / '+d.quality.total+' indicadores');
 set('#coverage',d.quality.coveragePercent+'%');
 qs('#coverageBar').style.width=d.quality.coveragePercent+'%';
 const modules=qs('#moduleList');modules.replaceChildren();
 for(const mod of d.modules){
  const card=document.createElement('article');card.className='module';
  const header=document.createElement('div');header.className='module-top';
  const title=document.createElement('b');title.textContent=mod.name;
  const tag=document.createElement('span');tag.className='pill '+(mod.status==='verificado'?'ok':mod.status==='nao_integrado'?'pending':'bad');
  tag.textContent=idToLabel[mod.status]||mod.status;header.append(title,tag);
  const desc=document.createElement('small');desc.textContent=mod.reason||(mod.status==='verificado'?'Consulta estruturada com valores rastreáveis.':'Sem dados validados.');
  const anchor=document.createElement('a');anchor.href=d.sources[mod.source]?.url||'#';anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent='Consultar fonte oficial ↗';
  card.append(header,desc,anchor);modules.append(card);
 }
 qs('#analysisTitle').textContent='Leitura social fundamentada';
 qs('#analysisMode').textContent='Análise ainda não solicitada';
 const body=qs('#analysisBody');body.replaceChildren();
 const p=document.createElement('p');p.textContent='Clique em Gerar análise social para relacionar os indicadores verificados e identificar os próximos passos, sem preencher lacunas.';body.append(p);
}
qs('#analysisBtn').onclick=async()=>{
 if(!state.data)return;
 const b=qs('#analysisBtn');b.disabled=true;b.textContent='Gerando análise...';
 try{
  const r=await fetch('/api/analise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ibge:state.data.municipio.codigoIBGE})});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Erro de análise');
  if(d.municipio.codigoIBGE!==state.data.municipio.codigoIBGE)throw new Error('Município divergente.');
  state.analysis=d.analysis;
  qs('#analysisTitle').textContent=d.analysis.title;
  qs('#analysisMode').textContent=d.analysis.mode==='ia'?'Gerada por IA · revisar tecnicamente':'Regras auditáveis · IA generativa não configurada';
  const area=qs('#analysisBody');area.replaceChildren();
  for(const text of d.analysis.paragraphs){const p=document.createElement('p');p.textContent=text;area.append(p);}
  for(const text of d.analysis.limitations){const p=document.createElement('p');p.style.fontSize='10px';p.style.color='#788aa0';p.textContent='Limitação: '+text;area.append(p);}
  status('Leitura social concluída. As interpretações exigem revisão humana antes de subsidiar uma proposta.');
 }catch(err){status(err.message,true)}
 finally{b.disabled=false;b.textContent='✧ Gerar análise social';}
};
async function downloadPdf(){
 if(!state.data)return;
 const buttons=[qs('#pdfTop'),qs('#pdfBottom')];buttons.forEach(x=>x.disabled=true);
 status('Gerando PDF institucional a partir de nova consulta oficial. Não serão utilizados números manipulados no navegador.');
 try{
  const r=await fetch('/api/relatorio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ibge:state.data.municipio.codigoIBGE})});
  if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.error||'Não foi possível produzir o relatório.')}
  if(!(r.headers.get('content-type')||'').includes('application/pdf'))throw new Error('O servidor não retornou um PDF.');
  const blob=await r.blob();if(blob.size<1000)throw new Error('O arquivo PDF está incompleto.');
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
  a.download='Rede-Cidada_Diagnostico_'+state.data.municipio.codigoIBGE+'.pdf';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
  status('Relatório gerado com indicadores, fontes, lacunas e análise técnica preliminar.');
 }catch(e){status(e.message,true)}
 finally{buttons.forEach(x=>x.disabled=false)}
}
qs('#pdfTop').onclick=downloadPdf;qs('#pdfBottom').onclick=downloadPdf;
const sections=document.querySelectorAll('main section[id]');
const nav=document.querySelectorAll('.side-nav a');
if('IntersectionObserver' in window){
 const observer=new IntersectionObserver(items=>{for(const it of items)if(it.isIntersecting)nav.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+it.target.id));},{rootMargin:'-20% 0px -64% 0px'});
 sections.forEach(s=>observer.observe(s));
}
