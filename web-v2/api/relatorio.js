'use strict';
const {PDFDocument, StandardFonts, rgb} = require('pdf-lib');
const {getDiagnosis} = require('./diagnostico');
const {factualAnalysis} = require('./analise');
const A4=[595.28,841.89];
const NAVY=rgb(.045,.105,.235), BLUE=rgb(.10,.24,.49), LIGHT=rgb(.94,.965,.984), GREEN=rgb(.77,.91,.53), GRAY=rgb(.36,.43,.52), WHITE=rgb(1,1,1), LINE=rgb(.85,.89,.93);
const fmt=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2});
const scrub=s=>String(s??'').replace(/[\u0000-\u001f]/g,' ').replace(/[\u2010-\u2015]/g,'-').replace(/[^\u0020-\u007e\u00a0-\u00ff\u20ac]/g,' ').replace(/\s+/g,' ').trim();
function formatItem(i){if(i.value===null)return 'INDISPONÍVEL';if(i.unit==='R$')return brl.format(i.value);return fmt.format(i.value)+(i.unit==='pessoas'?' pessoas':i.unit==='km²'?' km2':i.unit==='hab./km²'?' hab./km2':'');}
function wrap(str,font,size,maxWidth) {
 const words=scrub(str).split(' '), out=[]; let current='';
 for(const word of words){
  const test=current?current+' '+word:word;
  if(font.widthOfTextAtSize(test,size)>maxWidth && current){out.push(current);current=word;}
  else current=test;
 }
 if(current)out.push(current);
 return out;
}
function block(page,text,x,y,maxWidth,size,font,color=GRAY,lineHeight=size*1.48,maxLines=Infinity){
 const rows=wrap(text,font,size,maxWidth).slice(0,maxLines);
 for(const row of rows){page.drawText(row,{x,y,size,font,color});y-=lineHeight;}
 return y;
}
function roundedCard(page,x,y,w,h,background=LIGHT){
 page.drawRectangle({x,y:y-h,width:w,height:h,color:background,borderRadius:11});
}
function top(page,title,small,bold,regular,pageNumber){
 const [w,h]=A4;
 page.drawRectangle({x:0,y:h-72,width:w,height:72,color:NAVY});
 page.drawText('REDE CIDADÃ', {x:40,y:h-32,size:14,font:bold,color:WHITE});
 page.drawText('INTELIGÊNCIA TERRITORIAL', {x:40,y:h-50,size:8,font:regular,color:GREEN});
 page.drawText(scrub(title),{x:40,y:h-110,size:19,font:bold,color:NAVY});
 page.drawText(scrub(small),{x:40,y:h-130,size:9,font:regular,color:GRAY});
 footer(page,regular,pageNumber);
}
function footer(page,regular,n){
 page.drawLine({start:{x:40,y:48},end:{x:A4[0]-40,y:48},color:LINE,thickness:1});
 page.drawText('Diagnóstico Territorial Integrado | Rede Cidadã  -  Homologação v2', {x:40,y:32,font:regular,size:8,color:GRAY});
 page.drawText(String(n).padStart(2,'0'),{x:A4[0]-53,y:32,font:regular,size:8,color:GRAY});
}
async function generate(d){
 const pdf=await PDFDocument.create();
 const regular=await pdf.embedFont(StandardFonts.Helvetica);
 const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const stamp=new Date(d.generatedAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
 const city=d.municipio.nome+' / '+d.municipio.uf;
 const analysis=factualAnalysis(d);
 pdf.setTitle('Diagnóstico Territorial - '+city);
 pdf.setAuthor('Rede Cidadã | Diagnóstico Territorial Integrado');
 pdf.setSubject('Relatório de homologação com fontes públicas e indicação de lacunas');
 let page=pdf.addPage(A4),[w,h]=A4;
 page.drawRectangle({x:0,y:0,width:w,height:h,color:NAVY});
 page.drawRectangle({x:0,y:h-16,width:w,height:16,color:GREEN});
 page.drawText('REDE CIDADÃ',{x:46,y:h-86,font:bold,size:19,color:WHITE});
 page.drawText('OBSERVATÓRIO ESTRATÉGICO | PROJETOS SOCIAIS',{x:46,y:h-111,font:regular,size:9,color:GREEN});
 page.drawText('DIAGNÓSTICO',{x:46,y:610,font:bold,size:38,color:WHITE});
 page.drawText('TERRITORIAL',{x:46,y:563,font:bold,size:38,color:WHITE});
 page.drawRectangle({x:46,y:519,width:70,height:6,color:GREEN});
 let y=476;
 y=block(page,city,46,y,w-90,25,bold,WHITE,34);
 y=block(page,'Código IBGE: '+d.municipio.codigoIBGE+'   |   Consulta: '+stamp,46,y-10,w-90,11,regular,rgb(.75,.83,.9));
 roundedCard(page,46,275,w-92,125,BLUE);
 page.drawText('RESUMO DE CONFIABILIDADE',{x:64,y:364,size:10,font:bold,color:GREEN});
 page.drawText(d.quality.verified+' / '+d.quality.total,{x:64,y:309,size:30,font:bold,color:WHITE});
 page.drawText('Indicadores integrados validados',{x:189,y:322,size:12,font:regular,color:WHITE});
 page.drawText('Ausência de dado não equivale a valor zero.',{x:64,y:293,size:10,font:regular,color:rgb(.75,.83,.9)});
 block(page,'Este documento organiza informações de fontes públicas identificadas e distingue indicadores demonstrativos validados de bases ainda pendentes de integração. Não constitui, nesta fase, parecer conclusivo de viabilidade.',46,235,w-92,12,regular,WHITE,20);
 page.drawText('VERSÃO DE HOMOLOGAÇÃO  |  NÃO SUBSTITUI VALIDAÇÃO INSTITUCIONAL',{x:46,y:73,size:9,font:bold,color:GREEN});
 page.drawText('01 / 04',{x:w-95,y:48,size:9,font:regular,color:WHITE});

 page=pdf.addPage(A4);
 top(page,'Indicadores municipais','Município: '+city+' | Consulta: '+stamp,bold,regular,2);
 y=665;
 for(const i of d.indicators){
  roundedCard(page,40,y,515,65,i.status==='verificado'?LIGHT:rgb(.985,.987,.99));
  page.drawText(scrub(i.label),{x:55,y:y-20,size:10,font:bold,color:NAVY});
  page.drawText(scrub(formatItem(i)),{x:55,y:y-43,size:16,font:bold,color:i.status==='verificado'?BLUE:GRAY});
  page.drawText('Ref.: '+scrub(i.period)+'  |  '+scrub(d.sources[i.source]?.name||''),{x:292,y:y-44,size:8,font:regular,color:GRAY});
  y-=74;
 }
 y-=6;
 block(page,'Nota: somente números obtidos e interpretados a partir de estruturas identificadas são exibidos. As competências podem ser diferentes entre as fontes.',42,y,505,9,regular);

 page=pdf.addPage(A4);
 top(page,'Leitura social preliminar','Síntese automatizada com base nas informações verificadas',bold,regular,3);
 y=680;
 for(let i=0;i<analysis.paragraphs.length;i++){
  const paragraph=analysis.paragraphs[i];
  const lines=wrap(paragraph,regular,10.5,500);
  const needed=lines.length*15+19;
  if(y-needed<135)break;
  page.drawRectangle({x:40,y:y+9,width:4,height:Math.max(16,needed-10),color:i===0?GREEN:LINE});
  y=block(page,paragraph,54,y,491,10.5,regular,BLUE,15)-20;
 }
 y-=14;
 page.drawText('CAMINHOS DE APROFUNDAMENTO',{x:43,y,size:12,font:bold,color:NAVY});y-=28;
 for(const r of analysis.recommendations){
  const lines=wrap(r.reason,regular,9,478);
  const need=20+lines.length*13;
  if(y-need<65)break;
  page.drawText(scrub(r.title)+'  |  Prioridade '+scrub(r.priority),{x:46,y,size:10,font:bold,color:NAVY});y-=15;
  y=block(page,r.reason,46,y,480,9,regular,GRAY,13)-12;
 }

 page=pdf.addPage(A4);
 top(page,'Fontes, lacunas e rastreabilidade','Transparência metodológica e próximos dados necessários',bold,regular,4);
 y=684;
 page.drawText('BASES PÚBLICAS DE REFERÊNCIA',{x:40,y,size:12,font:bold,color:NAVY});y-=24;
 for(const [key,s] of Object.entries(d.sources)){
  if(y<355)break;
  page.drawText(scrub(s.name),{x:42,y,size:9.5,font:bold,color:BLUE});y-=14;
  y=block(page,s.url,42,y,507,7.5,regular,GRAY,10.5,2)-12;
 }
 y-=2;
 page.drawText('MÓDULOS AINDA NÃO VALIDADOS',{x:40,y,size:12,font:bold,color:NAVY});y-=23;
 for(const module of d.modules.filter(m=>m.status!=='verificado')){
  if(y<122)break;
  page.drawText('- '+scrub(module.name)+': '+scrub(module.reason||'sem indicadores verificados'),{x:42,y,size:8.8,font:regular,color:GRAY,maxWidth:510});
  y-=25;
 }
 if(y>92)block(page,'NOTA: Dados públicos não devem ser apresentados como atuais apenas porque foram consultados hoje. Sempre conferir ano de referência, método e qualidade de cobertura.',42,y-12,505,8.5,regular,GRAY);
 return pdf.save();
}
module.exports=async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Método não permitido'});
 const ibge=String(req.body?.ibge||'');
 if(!/^\d{7}$/.test(ibge))return res.status(400).json({error:'Código IBGE inválido'});
 try{
  const d=await getDiagnosis(ibge);
  const bytes=await generate(d);
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="diagnostico-territorial-'+ibge+'.pdf"');
  res.setHeader('Cache-Control','no-store');
  return res.status(200).send(Buffer.from(bytes));
 }catch(e){return res.status(502).json({error:'Não foi possível gerar PDF verificável. Revise as fontes e tente novamente.'})}
};
module.exports.generate=generate;