import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();
const workbookCache = new Map();

const RMA = {
  cras: 'https://aplicacoes.mds.gov.br/sagi/dicivip_datain/ckfinder/userfiles/files/RMA_CRAS_Criterios_2025_divulgacao_150526.xlsx',
  creas: 'https://aplicacoes.mds.gov.br/sagi/dicivip_datain/ckfinder/userfiles/files/RMA_CREAS_criterios_2025_divulga%C3%A7ao_150526.xlsx',
  pop: 'https://aplicacoes.mds.gov.br/sagi/dicivip_datain/ckfinder/userfiles/files/RMA_Centro_POP_Criterios_2025_divulgacao_150526.xlsx'
};
const IBGE = 'https://servicodados.ibge.gov.br/api/v3/agregados';
const SEBRAE = 'https://api-observatorio.sebrae.com.br/data.jsonrecords';
const MONTHS = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const clean = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? '').trim();
  if (!s || s === '-' || s === '—') return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/[^0-9.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const safe = v => finite(v) ? Number(v) : null;

async function fetchWithTimeout(url, options = {}, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      ...options,
      signal: ctrl.signal,
      headers: {
        'user-agent': 'RedeCidada-Diagnostico/1.1',
        'accept': '*/*',
        ...(options.headers || {})
      }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}
const fetchJson = async (url, ms=30000) => (await fetchWithTimeout(url, {}, ms)).json();
const fetchText = async (url, ms=30000) => (await fetchWithTimeout(url, {}, ms)).text();
const fetchBuffer = async (url, ms=45000) => Buffer.from(await (await fetchWithTimeout(url, {}, ms)).arrayBuffer());

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'public, max-age=300, stale-while-revalidate=3600'
  });
  res.end(JSON.stringify(body));
}

async function municipality(ibge, nome='', uf='') {
  const m = { ibge: String(ibge), nome, uf };
  if (m.nome && m.uf) return m;
  try {
    const d = await fetchJson(`https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${m.ibge}`, 15000);
    m.nome ||= d?.nome || '';
    m.uf ||= d?.microrregiao?.mesorregiao?.UF?.sigla || d?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla || '';
  } catch {}
  return m;
}

function field(row, patterns) {
  for (const [key, value] of Object.entries(row || {})) {
    const k = clean(key).replace(/[^a-z0-9]/g, '');
    if (patterns.some(rx => rx.test(k) || rx.test(clean(key)))) return value;
  }
}
async function workbookRows(url) {
  const hit = workbookCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rows;

  const buffer = await fetchBuffer(url);
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const rows = [];

  for (const sheet of wb.SheetNames) {
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '' });
    let headerIndex = -1;
    for (let i=0; i<Math.min(raw.length, 60); i++) {
      const r = (raw[i] || []).map(clean);
      if (r.some(x => /municip|codigo.*ibge|ibge/.test(x)) && r.filter(Boolean).length >= 5) {
        headerIndex = i;
        break;
      }
    }
    if (headerIndex < 0) continue;
    const headers = (raw[headerIndex] || []).map((x,i) => String(x || `col_${i}`).trim());
    for (const line of raw.slice(headerIndex + 1)) {
      if (!line?.some(x => String(x).trim() !== '')) continue;
      const o = { __sheet: sheet };
      headers.forEach((h,i) => o[h] = line[i]);
      rows.push(o);
    }
  }

  workbookCache.set(url, { at: Date.now(), rows });
  return rows;
}
function municipalityRows(rows, m) {
  return rows.filter(r => {
    const code = String(field(r, [/codigoibge/, /codigomunicip/, /^ibge$/]) ?? '').replace(/\D/g, '');
    if (code && (code === m.ibge || code.slice(0,6) === m.ibge.slice(0,6))) return true;
    const name = clean(field(r, [/^municipio$/, /nomemunicip/]) ?? '');
    const uf = clean(field(r, [/^uf$/, /siglauf/]) ?? '');
    return name && name === clean(m.nome) && (!uf || uf === clean(m.uf));
  });
}
function monthOf(row) {
  const v = field(row, [/^mes$/, /^mesreferencia$/, /^competencia$/, /^referencia$/]);
  if (v == null) return null;
  if (typeof v === 'number' && v >= 1 && v <= 12) return v;
  const map = {janeiro:1,fevereiro:2,marco:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12,jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12};
  const s = clean(v);
  if (map[s]) return map[s];
  const mt = String(v).match(/(?:^|\D)(1[0-2]|0?[1-9])(?:\D|$)/);
  return mt ? Number(mt[1]) : null;
}
function latestRows(rows) {
  const months = rows.map(monthOf).filter(Number.isFinite);
  if (!months.length) return { month:null, rows };
  const month = Math.max(...months);
  return { month, rows: rows.filter(r => monthOf(r) === month) };
}
function rmaValue(row, code) {
  const target = code.toLowerCase().replace('.', '');
  for (const [k,v] of Object.entries(row || {})) {
    const kk = clean(k).replace(/[^a-z0-9]/g, '');
    if (kk === target || kk.startsWith(target + '_') || kk === target + 'total' || kk.endsWith('_' + target)) return num(v);
  }
  return NaN;
}
function sumRma(rows, code) {
  let total=0, found=false;
  for (const r of rows) {
    const v = rmaValue(r, code);
    if (finite(v)) { total += Number(v); found=true; }
  }
  return found ? total : NaN;
}
function uniqueUnits(rows) {
  const s = new Set();
  for (const r of rows) for (const [k,v] of Object.entries(r)) {
    if (/identificador|id unidade|codigo.*unidade|nu_identificador/.test(clean(k)) && String(v).trim()) s.add(String(v).trim());
  }
  return s.size || null;
}

async function getMse(m) {
  const rows = municipalityRows(await workbookRows(RMA.creas), m);
  if (!rows.length) throw new Error('Município não localizado no RMA CREAS 2025');
  const latest = latestRows(rows);
  return {
    year: 2025,
    month: latest.month,
    monthLabel: latest.month ? MONTHS[latest.month] : null,
    j1:safe(sumRma(latest.rows,'j1')),
    j2:safe(sumRma(latest.rows,'j2')),
    j3:safe(sumRma(latest.rows,'j3')),
    j4:safe(sumRma(latest.rows,'j4')),
    j5:safe(sumRma(latest.rows,'j5')),
    j6:safe(sumRma(latest.rows,'j6'))
  };
}
async function getPopRua(m) {
  const rows = municipalityRows(await workbookRows(RMA.pop), m);
  if (!rows.length) throw new Error('Município não localizado no RMA Centro POP 2025');
  const latest = latestRows(rows);
  return {
    year:2025,
    month:latest.month,
    monthLabel:latest.month ? MONTHS[latest.month] : null,
    a1:safe(sumRma(latest.rows,'a1')),
    d1:safe(sumRma(latest.rows,'d1')),
    e1:safe(sumRma(latest.rows,'e1')),
    f1:safe(sumRma(latest.rows,'f1')),
    c1:safe(sumRma(latest.rows,'c1')),
    c2:safe(sumRma(latest.rows,'c2'))
  };
}
async function getSuas(m) {
  const [cras,creas,pop] = await Promise.all([workbookRows(RMA.cras),workbookRows(RMA.creas),workbookRows(RMA.pop)]);
  return {
    year:2025,
    cras:uniqueUnits(municipalityRows(cras,m)),
    creas:uniqueUnits(municipalityRows(creas,m)),
    centroPop:uniqueUnits(municipalityRows(pop,m))
  };
}

function dcaValue(items, code) {
  const liq = items.filter(x => clean(x.coluna).includes('despesas liquidadas'));
  const r = liq.find(x => String(x.cod_interno ?? '').trim() === code) ||
            liq.find(x => clean(x.conta).startsWith(clean(code) + ' -'));
  return r ? num(r.valor) : NaN;
}
function rreoValue(items, rx) {
  const liquid = items.filter(x => clean(x.coluna).includes('despesas liquidadas'));
  const preferred = liquid.filter(x => clean(x.coluna).includes('ate o bimestre'));
  const pool = preferred.length ? preferred : liquid;
  const r = pool.find(x => rx.test(clean(x.conta || x.cod_conta || x.rotulo || '')));
  return r ? num(r.valor) : NaN;
}
async function getBudget(m) {
  let items=[], year=null, reference='';

  for (const y of [2025,2024,2023,2022,2021]) {
    try {
      const u = new URL('https://apidatalake.tesouro.gov.br/ords/siconfi/tt/dca');
      u.searchParams.set('an_exercicio', y);
      u.searchParams.set('no_anexo', 'DCA-Anexo I-E');
      u.searchParams.set('id_ente', m.ibge);
      const d = await fetchJson(u, 30000);
      if (Array.isArray(d?.items) && d.items.length) {
        items=d.items; year=y; reference=`DCA ${y} · despesas liquidadas`; break;
      }
    } catch {}
  }

  let total=NaN, assist=NaN, health=NaN, education=NaN;

  if (items.length) {
    const liq = items.filter(x => clean(x.coluna).includes('despesas liquidadas'));
    const funcs = liq.filter(x => /^\d{2}$/.test(String(x.cod_interno ?? '')));
    total = funcs.reduce((s,x) => s + (finite(num(x.valor)) ? num(x.valor) : 0), 0);
    assist=dcaValue(items,'08'); health=dcaValue(items,'10'); education=dcaValue(items,'12');
  } else {
    for (const [y,p] of [[2026,4],[2026,3],[2026,2],[2026,1],[2025,6],[2025,5],[2025,4]]) {
      try {
        const u = new URL('https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo');
        const params={an_exercicio:y,nr_periodo:p,co_tipo_demonstrativo:'RREO',no_anexo:'RREO-Anexo 02',co_esfera:'M',id_ente:m.ibge};
        Object.entries(params).forEach(([k,v]) => u.searchParams.set(k,v));
        const d=await fetchJson(u,30000);
        if (Array.isArray(d?.items) && d.items.length) {
          items=d.items; year=y; reference=`RREO ${y} · ${p}º bimestre · despesas liquidadas`; break;
        }
      } catch {}
    }
    if (items.length) {
      assist=rreoValue(items,/^assistencia social$|\bassistencia social\b/);
      health=rreoValue(items,/^saude$|\bsaude\b/);
      education=rreoValue(items,/^educacao$|\beducacao\b/);
      total=rreoValue(items,/despesas \(exceto intra|total.*despesa/);
    }
  }

  if (!items.length) throw new Error('SICONFI sem demonstrativo encontrado');

  const sub = c => dcaValue(items,c);
  const sum = (...xs) => {
    const a=xs.filter(finite);
    return a.length ? a.reduce((s,v)=>s+Number(v),0) : NaN;
  };
  const env=['18.541','18.542','18.543','18.544'].map(sub).filter(finite);

  return {
    year, reference,
    total:safe(total),
    assist:safe(assist),
    health:safe(health),
    education:safe(education),
    child:safe(sub('08.243')),
    elderly:safe(sub('08.241')),
    community:safe(sub('08.244')),
    work:safe(sum(sub('11.333'),sub('11.334'))),
    qualification:safe(sum(sub('12.363'),sub('11.333'))),
    apprentice:safe(sum(sub('12.363'),sub('11.333'))),
    digital:safe(sub('04.126')),
    care:safe(sum(sub('08.241'),sub('08.244'))),
    environment:safe(env.length ? env.reduce((a,b)=>a+b,0) : NaN),
    entrepreneur:safe(sum(sub('11.334'),sub('23.691')))
  };
}

async function ibgeMeta(table) {
  return fetchJson(`${IBGE}/${table}/metadados`, 20000);
}
function totalCategory(c) {
  const cats=Array.isArray(c?.categorias) ? c.categorias : [];
  return cats.find(a => clean(a.nome)==='total')?.id ?? cats[0]?.id ?? 'all';
}
function classQuery(meta, expand=[]) {
  return (meta?.classificacoes || []).map(c => `${c.id}[${expand.some(rx=>rx.test(clean(c.nome)))?'all':totalCategory(c)}]`).join('|');
}
async function ibgeData(table, period, vars, m, classif='') {
  const u=new URL(`${IBGE}/${table}/periodos/${period}/variaveis/${vars}`);
  u.searchParams.set('localidades',`N6[${m.ibge}]`);
  if (classif) u.searchParams.set('classificacao',classif);
  return fetchJson(u,25000);
}
function aggFlat(data) {
  const out=[];
  for (const v of (Array.isArray(data)?data:[])) for (const r of (v.resultados||[])) {
    const labels=(r.classificacoes||[]).flatMap(c=>Object.values(c.categoria||{}));
    for (const s of (r.series||[])) for (const [period,value] of Object.entries(s.serie||{})) {
      out.push({variable:v.variavel||'',value:num(value),labels,period});
    }
  }
  return out;
}
async function sebrae(params, ms=25000) {
  const u=new URL(SEBRAE);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k,v));
  u.searchParams.set('locale','pt');
  const d=await fetchJson(u,ms);
  return Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [];
}
async function getEducation(m) {
  const out={
    literacyPercent:null,
    lowEducationPercent:null,
    instruction:null,
    enrollments:null,
    teachers:null,
    classes:null,
    year:null,
    idebInitial:null,
    idebFinal:null,
    idebYear:null
  };

  try {
    const meta=await ibgeMeta(9543);
    const d=await ibgeData(9543,2022,'all',m,classQuery(meta,[]));
    const r=aggFlat(d).find(x => finite(x.value) && clean(x.variable).includes('taxa de alfabetizacao'));
    if (r) out.literacyPercent=safe(r.value);
  } catch {}

  try {
    const meta=await ibgeMeta(10061);
    const d=await ibgeData(10061,2022,'all',m,classQuery(meta,[/nivel de instrucao/]));
    const rows=aggFlat(d).filter(x => finite(x.value) && !clean(x.variable).includes('percentual'));
    const labels=['Sem instrução e fundamental incompleto','Fundamental completo e médio incompleto','Médio completo e superior incompleto','Superior completo'];
    const values=labels.map(l => rows.find(x=>x.labels.some(a=>clean(a)===clean(l)))?.value || 0);
    const total=values.reduce((a,b)=>a+b,0);
    if (total) {
      out.instruction={labels,values,total};
      out.lowEducationPercent=100*(values[0]+values[1])/total;
    }
  } catch {}

  for (const y of [2025,2024,2023]) {
    try {
      const rows=await sebrae({cube:'INEP_Censo_Ed_Basica',drilldowns:'Municipality,Year',measures:'Enrollments,Teachers,Classes',Municipality:m.ibge,Year:y,parents:'false'});
      if (rows.length) {
        const r=rows[0];
        out.enrollments=safe(num(r.Enrollments));
        out.teachers=safe(num(r.Teachers));
        out.classes=safe(num(r.Classes));
        out.year=y;
        break;
      }
    } catch {}
  }

  for (const y of [2023,2021]) {
    try {
      const rows=await sebrae({cube:'INEP_IDEB_Municipio',drilldowns:'Municipality,Year,Education Level',measures:'IDEB Index',Municipality:m.ibge,Year:y,parents:'false'});
      if (rows.length) {
        const ini=rows.find(r=>/iniciais/i.test(r['Education Level']||''));
        const fin=rows.find(r=>/finais/i.test(r['Education Level']||''));
        out.idebInitial=safe(num(ini?.['IDEB Index']));
        out.idebFinal=safe(num(fin?.['IDEB Index']));
        out.idebYear=y;
        break;
      }
    } catch {}
  }

  if (![out.literacyPercent,out.lowEducationPercent,out.enrollments,out.teachers,out.idebInitial,out.idebFinal].some(finite)) {
    throw new Error('Bases educacionais sem retorno');
  }
  return out;
}

function parseBRNumber(s) {
  if (!s) return NaN;
  const x=String(s).replace(/\s/g,'').replace(/\./g,'').replace(',','.').replace(/[^0-9.\-]/g,'');
  return num(x);
}
function findTextNumber(text, patterns) {
  for (const rx of patterns) {
    const m=text.match(rx);
    if (m) return parseBRNumber(m[1]);
  }
  return NaN;
}
async function getCadunico(m) {
  let text='';
  for (const code of [m.ibge,m.ibge.slice(0,6)]) {
    for (const url of [
      `https://aplicacoes.mds.gov.br/sagi/RIv3/geral/index.php?codigo=${code}`,
      `https://aplicacoes.cidadania.gov.br/ri/ri/relatorios/cidadania/?codigo=${code}`
    ]) {
      try {
        const t=await fetchText(url,22000);
        if (t && t.length>2500) { text=t; break; }
      } catch {}
    }
    if (text) break;
  }
  if (!text) throw new Error('RI Social sem retorno');

  const families=findTextNumber(text,[
    /(?:fam[ií]lias)[^\d]{0,100}(?:cadastrad|inscrit)[^\d]{0,35}([\d\.]+)/i,
    /([\d\.]+)\s*fam[ií]lias[^\n]{0,80}cadastro [uú]nico/i
  ]);
  const people=findTextNumber(text,[
    /(?:pessoas)[^\d]{0,100}(?:cadastrad|inscrit)[^\d]{0,35}([\d\.]+)/i,
    /([\d\.]+)\s*pessoas[^\n]{0,80}cadastro [uú]nico/i
  ]);
  const low=findTextNumber(text,[
    /(?:baixa renda|pobreza)[^\d]{0,100}([\d\.]+)\s*(?:fam[ií]lias|pessoas)/i,
    /([\d\.]+)\s*(?:fam[ií]lias|pessoas)[^\n]{0,100}(?:baixa renda|pobreza)/i
  ]);
  const street=findTextNumber(text,[
    /(?:situa[cç][aã]o de rua)[^\d]{0,100}([\d\.]+)\s*(?:pessoas|fam[ií]lias)/i,
    /([\d\.]+)\s*(?:pessoas|fam[ií]lias)[^\n]{0,100}(?:situa[cç][aã]o de rua)/i
  ]);

  return {
    families:safe(families),
    people:safe(people),
    lowIncome:safe(low),
    street:safe(street),
    source:'MDS · RI Social'
  };
}

function parseCsvLine(line, sep=',') {
  const out=[]; let cur='', q=false;
  for (let i=0;i<line.length;i++) {
    const c=line[i];
    if (c==='"') {
      if (q && line[i+1]==='"') { cur+='"'; i++; }
      else q=!q;
    } else if (c===sep && !q) { out.push(cur); cur=''; }
    else cur+=c;
  }
  out.push(cur);
  return out;
}
async function localIvcad(m) {
  const file=path.join(__dirname,'data','ivcad.csv');
  if (!existsSync(file)) return null;
  const txt=await readFile(file,'utf8');
  const lines=txt.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
  if (lines.length<2) return null;
  const sep=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':',';
  const headers=parseCsvLine(lines[0],sep).map(clean);
  for (const line of lines.slice(1)) {
    const a=parseCsvLine(line,sep), o={};
    headers.forEach((h,i)=>o[h]=a[i]);
    const code=String(o.codigo_ibge||o.codigoibge||'').replace(/\D/g,'');
    if (code!==m.ibge) continue;
    return {
      general:safe(num(o.ivcad)),
      dims:{
        NC:safe(num(o.nc)),
        DPI:safe(num(o.dpi)),
        DCA:safe(num(o.dca)),
        TQA:safe(num(o.tqa)),
        DR:safe(num(o.dr)),
        CH:safe(num(o.ch))
      },
      indicators:{},
      source:'Base estruturada local IVCAD',
      reference:o.referencia||''
    };
  }
  return null;
}
function normalizeIvcad(raw) {
  if (!raw || typeof raw!=='object') return null;
  const dimsRaw=raw.dimensoes||raw.dimensions||raw.dims||{};
  const general=num(raw.ivcad??raw.general??raw.indice);
  const pick=(...keys) => {
    for (const k of keys) if (dimsRaw[k]!=null) return num(dimsRaw[k]);
    return NaN;
  };
  const dims={
    NC:pick('NC','cuidados','necessidade_cuidados'),
    DPI:pick('DPI','primeira_infancia'),
    DCA:pick('DCA','criancas_adolescentes'),
    TQA:pick('TQA','trabalho_qualificacao'),
    DR:pick('DR','recursos','disponibilidade_recursos'),
    CH:pick('CH','habitacao','condicoes_habitacionais')
  };
  if (!finite(general) && !Object.values(dims).some(finite)) return null;
  return {
    general:safe(general),
    dims:Object.fromEntries(Object.entries(dims).map(([k,v])=>[k,safe(v)])),
    indicators:raw.indicadores||raw.indicators||{},
    source:raw.fonte||raw.source||'IVCAD estruturado',
    reference:raw.referencia||raw.reference||raw.competencia||''
  };
}
async function ipsIvcad(m) {
  const uf=m.ibge.slice(0,2);
  for (const y of [2026,2025]) {
    const target=`https://ipsbrasil.org.br/pt/explore/dados/download?page=1&per_page=1000&sort_by=id&sort_order=asc&year=${y}&states=${uf}`;
    for (const url of [target,`https://r.jina.ai/${target}`]) {
      try {
        const text=await fetchText(url,24000);
        const lines=text.split(/\r?\n/);
        const hLine=lines.find(l=>/C[oó]digo IBGE/i.test(l)&&/Vulnerabilidade.*Cad|IVCAD/i.test(l));
        const rLine=lines.find(l=>new RegExp(`(^|\\|\\s*)${m.ibge}(\\s*\\||\\s)`).test(l));
        if (!hLine || !rLine || !hLine.includes('|') || !rLine.includes('|')) continue;
        const split=l=>l.split('|').map(x=>x.trim()).filter(Boolean);
        const h=split(hLine), r=split(rLine);
        const ix=h.findIndex(x=>/Vulnerabilidade.*Cad|IVCAD/i.test(x));
        if (ix>=0) {
          const v=num(r[ix]);
          if (finite(v)) return {
            general:safe(v),
            dims:{NC:null,DPI:null,DCA:null,TQA:null,DR:null,CH:null},
            indicators:{},
            source:`IPS Brasil ${y} · fonte original CadÚnico/MDS`,
            reference:String(y)
          };
        }
      } catch {}
    }
  }
  return null;
}
async function getIvcad(m) {
  const local=await localIvcad(m);
  if (local) return local;

  const template=String(process.env.IVCAD_JSON_URL_TEMPLATE||'').trim();
  if (template) {
    try {
      const x=normalizeIvcad(await fetchJson(template.replace('{ibge}',encodeURIComponent(m.ibge)),24000));
      if (x) return x;
    } catch {}
  }

  const ips=await ipsIvcad(m);
  if (ips) return ips;
  throw new Error('IVCAD estruturado não localizado; painel oficial permanece como conferência');
}



/* ===== v1.2 — robustez para RMA/SUAS, IPS/IVCAD, educação e orçamento ===== */
function htmlDecode(s){
  return String(s??'')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}
function stripHtml(s){
  return htmlDecode(String(s??'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
}
function parseHtmlTables(html){
  const tables=[];
  const tableMatches=[...String(html||'').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  for(const tm of tableMatches){
    const rows=[];
    for(const rm of tm[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[...rm[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>stripHtml(x[1]));
      if(cells.length)rows.push(cells);
    }
    if(rows.length)tables.push(rows);
  }
  return tables;
}
function periodKey(s){
  const m=String(s||'').match(/(0?[1-9]|1[0-2])\s*\/\s*(20\d{2})/);
  if(!m)return null;
  return {month:Number(m[1]),year:Number(m[2]),key:Number(m[2])*100+Number(m[1])};
}
function parseRmaUnitPage(html){
  for(const rows of parseHtmlTables(html)){
    let hi=rows.findIndex(r=>r.some(x=>/^refer[eê]ncia$/i.test(clean(x))) && r.length>5);
    if(hi<0)hi=rows.findIndex(r=>r.some(x=>/^refer[eê]ncia/i.test(clean(x))) && r.length>5);
    if(hi<0)continue;
    const headers=rows[hi].map(x=>clean(x).replace(/[^a-z0-9]/g,''));
    const out=[];
    for(const row of rows.slice(hi+1)){
      const p=periodKey(row[0]);
      if(!p)continue;
      const values={};
      headers.forEach((h,i)=>{
        if(!h||i===0)return;
        const v=num(row[i]);
        if(finite(v))values[h]=Number(v);
      });
      out.push({...p,values});
    }
    if(out.length)return out;
  }
  return [];
}
async function rmaMunicipalIndex(m){
  const code6=String(m.ibge).slice(0,6);
  const url=`https://aplicacoes.mds.gov.br/sagi/atendimento/adm/lista_preenchimento_unidade.php?p_ibge=${code6}`;
  const html=await fetchText(url,25000);
  const types={cras:new Set(),creas:new Set(),pop:new Set()};

  // 1) Tenta links/handlers presentes no HTML original.
  const rules=[
    ['cras',/lista_preenchimento_cras_unidade\.php[^"'<>]*?p_id_cras[=:'"\\s]+(\d{10,12})/gi],
    ['creas',/lista_preenchimento_creas_unidade\.php[^"'<>]*?p_id_creas[=:'"\\s]+(\d{10,12})/gi],
    ['pop',/lista_preenchimento_centropop_unidade\.php[^"'<>]*?p_id_unidade[=:'"\\s]+(\d{10,12})/gi]
  ];
  for(const [type,rx] of rules)for(const mm of html.matchAll(rx))types[type].add(mm[1]);

  // 2) Contingência mais robusta: a página pública separa os IDs em blocos
  // IDCRAS ... IDCREAS ... IDCENTROPOP.
  const txt=stripHtml(html);
  const section=(from,to)=>{
    const i=clean(txt).indexOf(clean(from));
    if(i<0)return '';
    const rest=txt.slice(i);
    const j=to?clean(rest).indexOf(clean(to)): -1;
    return j>0?rest.slice(0,j):rest;
  };
  const addIds=(set,segment)=>{
    for(const mm of String(segment||'').matchAll(/\b(\d{11})\b/g))set.add(mm[1]);
  };
  if(!types.cras.size)addIds(types.cras,section('IDCRAS','IDCREAS'));
  if(!types.creas.size)addIds(types.creas,section('IDCREAS','IDCENTROPOP'));
  if(!types.pop.size)addIds(types.pop,section('IDCENTROPOP','Voltar'));

  if(!types.cras.size&&!types.creas.size&&!types.pop.size){
    throw new Error('RMA: página municipal respondeu, mas nenhuma unidade foi identificada');
  }
  return {url,types:{cras:[...types.cras],creas:[...types.creas],pop:[...types.pop]}};
}
async function rmaUnitSeries(type,id){
  const url=type==='cras'
    ? `https://aplicacoes.mds.gov.br/sagi/atendimento/adm/lista_preenchimento_cras_unidade.php?p_id_cras=${id}`
    : type==='creas'
    ? `https://aplicacoes.mds.gov.br/sagi/atendimento/adm/lista_preenchimento_creas_unidade.php?p_id_creas=${id}`
    : `https://aplicacoes.mds.gov.br/sagi/atendimento/adm/lista_preenchimento_centropop_unidade.php?p_id_unidade=${id}`;
  const html=await fetchText(url,25000);
  const series=parseRmaUnitPage(html);
  if(!series.length)throw new Error(`RMA ${type}: unidade ${id} sem tabela legível`);
  return {id,url,series};
}
function chooseRmaPeriod(units){
  const count=new Map(),total=units.length;
  for(const u of units){
    const seen=new Set(u.series.map(r=>r.key));
    for(const k of seen)count.set(k,(count.get(k)||0)+1);
  }
  const all=[...count.entries()].map(([key,n])=>({key,n,year:Math.floor(key/100),month:key%100}));
  if(!all.length)return null;
  const threshold=Math.max(1,Math.ceil(total*.7));
  const complete=all.filter(x=>x.n>=threshold).sort((a,b)=>b.key-a.key);
  if(complete.length)return {...complete[0],total};
  all.sort((a,b)=>b.n-a.n||b.key-a.key);
  return {...all[0],total};
}
function aggregateRma(units,key,codes){
  const out={};
  for(const code of codes)out[code]=0;
  const found=Object.fromEntries(codes.map(k=>[k,false]));
  let reporting=0;
  for(const u of units){
    const row=u.series.find(r=>r.key===key);
    if(!row)continue;
    reporting++;
    for(const code of codes){
      let v=row.values[code];
      if(!finite(v) && ['j4','j5','j6'].includes(code)){
        const a=row.values[code+'a'],b=row.values[code+'b'];
        if(finite(a)||finite(b))v=(Number(a)||0)+(Number(b)||0);
      }
      if(finite(v)){out[code]+=Number(v);found[code]=true}
    }
  }
  for(const k of codes)if(!found[k])out[k]=null;
  return {values:out,reporting};
}
function rmaTrend(units,code,limit=6){
  const keys=[...new Set(units.flatMap(u=>u.series.map(r=>r.key)))].sort((a,b)=>b-a).slice(0,12);
  const rows=[];
  for(const key of keys){
    const agg=aggregateRma(units,key,[code]);
    if(finite(agg.values[code]))rows.push({year:Math.floor(key/100),month:key%100,value:Number(agg.values[code]),reporting:agg.reporting});
    if(rows.length>=limit)break;
  }
  return rows.reverse();
}
getMse=async function(m){
  const idx=await rmaMunicipalIndex(m);
  if(!idx.types.creas.length)throw new Error('RMA: nenhum CREAS localizado para o município');
  const settledUnits=await Promise.allSettled(idx.types.creas.map(id=>rmaUnitSeries('creas',id)));
  const units=settledUnits.filter(x=>x.status==='fulfilled').map(x=>x.value);
  if(!units.length)throw new Error('RMA CREAS: nenhuma unidade respondeu');
  const p=chooseRmaPeriod(units); if(!p)throw new Error('RMA CREAS sem competência legível');
  const a=aggregateRma(units,p.key,['j1','j2','j3','j4','j5','j6']);
  return {year:p.year,month:p.month,monthLabel:MONTHS[p.month],...a.values,unitsTotal:idx.types.creas.length,unitsReporting:a.reporting,coverage:a.reporting/idx.types.creas.length,trend:rmaTrend(units,'j1',6),source:'MDS · RMA CREAS (consulta pública por unidade)',reference:`${String(p.month).padStart(2,'0')}/${p.year}`};
}
getPopRua=async function(m){
  const idx=await rmaMunicipalIndex(m);
  if(!idx.types.pop.length)throw new Error('RMA: nenhum Centro POP localizado para o município');
  const settledUnits=await Promise.allSettled(idx.types.pop.map(id=>rmaUnitSeries('pop',id)));
  const units=settledUnits.filter(x=>x.status==='fulfilled').map(x=>x.value);
  if(!units.length)throw new Error('RMA Centro POP: nenhuma unidade respondeu');
  const p=chooseRmaPeriod(units); if(!p)throw new Error('RMA Centro POP sem competência legível');
  const a=aggregateRma(units,p.key,['a1','c1','c2','d1','e1','f1']);
  return {year:p.year,month:p.month,monthLabel:MONTHS[p.month],...a.values,unitsTotal:idx.types.pop.length,unitsReporting:a.reporting,coverage:a.reporting/idx.types.pop.length,trend:rmaTrend(units,'a1',6),source:'MDS · RMA Centro POP (consulta pública por unidade)',reference:`${String(p.month).padStart(2,'0')}/${p.year}`};
}
getSuas=async function(m){
  const idx=await rmaMunicipalIndex(m);
  return {year:new Date().getFullYear(),cras:idx.types.cras.length,creas:idx.types.creas.length,centroPop:idx.types.pop.length,source:'MDS · Sistema RMA · unidades cadastradas',reference:'consulta municipal'};
}
function slugifyPt(s){
  return clean(s).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
function plainPageText(html){
  return htmlDecode(String(html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|li|div|tr|section|article|h\d)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n');
}
function labeledNumber(text,labelRx){
  const m=text.match(new RegExp(labelRx.source+'[\\\\s\\\\S]{0,220}?([0-9][0-9.]*?(?:,[0-9]+)?)\\\\s*(?:matr[ií]culas|docentes|escolas|%|\\\\[)',labelRx.flags.includes('i')?'i':''));
  return m?num(m[1]):NaN;
}
function labeledYear(text,labelRx){
  const m=text.match(new RegExp(labelRx.source+'[\\\\s\\\\S]{0,260}?\\\\[(20\\\\d{2})\\\\]',labelRx.flags.includes('i')?'i':''));
  return m?Number(m[1]):null;
}
async function ibgeCityEducation(m){
  if(!m.uf||!m.nome)return null;
  try{
    const url=`https://www.ibge.gov.br/cidades-e-estados/${String(m.uf).toLowerCase()}/${slugifyPt(m.nome)}`;
    const text=plainPageText(await fetchText(url,25000));
    const rFund=/Matr[ií]culas no ensino fundamental/i,rTeach=/Docentes no ensino fundamental/i,rSchool=/N[uú]mero de estabelecimentos de ensino fundamental/i;
    const rIni=/IDEB\s*[–-]\s*Anos iniciais do ensino fundamental/i,rFin=/IDEB\s*[–-]\s*Anos finais do ensino fundamental/i;
    const get=(rx)=>{const mm=text.match(new RegExp(rx.source+'[\\\\s\\\\S]{0,180}?([0-9]+(?:[.,][0-9]+)?)', 'i'));return mm?num(mm[1]):NaN};
    return {enrollments:safe(labeledNumber(text,rFund)),teachers:safe(labeledNumber(text,rTeach)),schools:safe(labeledNumber(text,rSchool)),idebInitial:safe(get(rIni)),idebFinal:safe(get(rFin)),year:labeledYear(text,rFund),idebYear:labeledYear(text,rIni),source:'IBGE Cidades · fonte educacional INEP'};
  }catch{return null}
}
let ipsCacheV12=new Map();
function tableObjectFromHtml(html,ibge){
  for(const rows of parseHtmlTables(html)){
    const hi=rows.findIndex(r=>r.some(x=>/c[oó]digo ibge/i.test(x))&&r.some(x=>/munic[ií]pio/i.test(x)));
    if(hi<0)continue;
    const headers=rows[hi].map(x=>String(x).trim());
    for(const row of rows.slice(hi+1)){
      const code=String(row[0]||'').replace(/\D/g,'');
      if(code!==String(ibge))continue;
      const o={};headers.forEach((h,i)=>o[h]=row[i]??'');return o;
    }
  }
  return null;
}
async function ipsMunicipalRow(m){
  if(ipsCacheV12.has(m.ibge))return ipsCacheV12.get(m.ibge);
  const stateCode=String(m.ibge).slice(0,2);
  const urls=[
    `https://ipsbrasil.org.br/blog/explore/dados/download?page=1&per_page=1000&sort_by%5Bmunicipality_data%5D=municipality_name&sort_order=asc&year=2025&states=${stateCode}`,
    `https://ipsbrasil.org.br/pt/explore/dados?page=1&per_page=1000&sort_by%5Bmunicipality_data%5D=municipality_name&sort_order=asc&year=2025&states=${stateCode}`
  ];
  for(const u of urls){
    try{const row=tableObjectFromHtml(await fetchText(u,30000),m.ibge);if(row){ipsCacheV12.set(m.ibge,row);return row}}catch{}
  }
  return null;
}
function rowVal(row,rx){
  if(!row)return NaN;
  for(const [k,v] of Object.entries(row))if(rx.test(clean(k)))return num(v);
  return NaN;
}
function ivcadNorm(v){
  let n=num(v);if(!finite(n))return NaN;
  if(n>1&&n<=100)n/=100;
  return n>=0&&n<=1?n:NaN;
}
getIvcad=async function(m){
  const local=await localIvcad(m);if(local&&finite(local.general))return local;
  const template=String(process.env.IVCAD_JSON_URL_TEMPLATE||'').trim();
  if(template){try{const x=normalizeIvcad(await fetchJson(template.replace('{ibge}',encodeURIComponent(m.ibge)),24000));if(x)return x}catch{}}
  try{
    const row=await ipsMunicipalRow(m),v=ivcadNorm(rowVal(row,/indice de vulnerabilidade das familias do cadastro unico|ivcad/));
    if(finite(v))return {general:Number(v),dims:{NC:null,DPI:null,DCA:null,TQA:null,DR:null,CH:null},indicators:{},source:'IPS Brasil 2025 · fonte original Cadastro Único/MDS',reference:'2025'};
  }catch{}
  throw new Error('IVCAD geral não localizado em fonte estruturada; dimensões permanecem disponíveis no painel oficial do MDS');
}
async function latestSebraeYear(cube){
  try{
    const u=new URL('https://api-observatorio.sebrae.com.br/members');u.searchParams.set('cube',cube);u.searchParams.set('level','Year');u.searchParams.set('locale','pt');
    const d=await fetchJson(u,18000);const years=(d?.data||[]).map(x=>Number(x.ID??x.Year??x.Label)).filter(x=>x>=2000&&x<=2100).sort((a,b)=>b-a);
    return years;
  }catch{return[]}
}
getEducation=async function(m){
  const out={literacyPercent:null,lowEducationPercent:null,instruction:null,enrollments:null,teachers:null,classes:null,schools:null,year:null,idebInitial:null,idebFinal:null,idebYear:null};
  try{const meta=await ibgeMeta(9543),d=await ibgeData(9543,2022,'all',m,classQuery(meta,[])),r=aggFlat(d).find(x=>finite(x.value)&&clean(x.variable).includes('taxa de alfabetizacao'));if(r)out.literacyPercent=safe(r.value)}catch{}
  try{
    const meta=await ibgeMeta(10061),d=await ibgeData(10061,2022,'all',m,classQuery(meta,[/nivel de instrucao/])),rows=aggFlat(d).filter(x=>finite(x.value)&&!clean(x.variable).includes('percentual'));
    const labels=['Sem instrução e fundamental incompleto','Fundamental completo e médio incompleto','Médio completo e superior incompleto','Superior completo'];
    const values=labels.map(l=>rows.find(x=>x.labels.some(a=>clean(a)===clean(l)))?.value||0),total=values.reduce((a,b)=>a+b,0);
    if(total){out.instruction={labels,values,total};out.lowEducationPercent=100*(values[0]+values[1])/total}
  }catch{}
  const years=(await latestSebraeYear('INEP_Censo_Ed_Basica')).slice(0,5);for(const y of (years.length?years:[2025,2024,2023,2022])){
    try{const rows=await sebrae({cube:'INEP_Censo_Ed_Basica',drilldowns:'Municipality,Year',measures:'Enrollments,Teachers,Classes',Municipality:m.ibge,Year:y,parents:'false'},22000);if(rows.length){const r=rows[0];out.enrollments=safe(num(r.Enrollments));out.teachers=safe(num(r.Teachers));out.classes=safe(num(r.Classes));out.year=y;break}}catch{}
  }
  const idebYears=(await latestSebraeYear('INEP_IDEB_Municipio')).slice(0,5);for(const y of (idebYears.length?idebYears:[2025,2023,2021])){
    try{
      const rows=await sebrae({cube:'INEP_IDEB_Municipio',drilldowns:'Municipality,Year,Education Level',measures:'IDEB Index',Municipality:m.ibge,Year:y,parents:'false'},22000);
      if(rows.length){const valid=rows.filter(r=>finite(num(r['IDEB Index']))),avg=a=>a.length?a.reduce((s,r)=>s+num(r['IDEB Index']),0)/a.length:NaN,ini=valid.filter(r=>/iniciais|early/i.test(r['Education Level']||'')),fin=valid.filter(r=>/finais|final/i.test(r['Education Level']||''));out.idebInitial=safe(avg(ini));out.idebFinal=safe(avg(fin));out.idebYear=y;if(finite(out.idebInitial)||finite(out.idebFinal))break}
    }catch{}
  }
  const city=await ibgeCityEducation(m);
  if(city){
    for(const k of ['enrollments','teachers','schools','idebInitial','idebFinal'])if(!finite(out[k])&&finite(city[k]))out[k]=Number(city[k]);
    out.year ||= city.year;out.idebYear ||= city.idebYear;
  }
  if(!finite(out.idebInitial)&&!finite(out.idebFinal)){
    try{const row=await ipsMunicipalRow(m),v=rowVal(row,/ideb ensino fundamental/);if(finite(v)){out.idebInitial=Number(v);out.idebYear=2025}}catch{}
  }
  if(![out.literacyPercent,out.lowEducationPercent,out.enrollments,out.teachers,out.idebInitial,out.idebFinal].some(finite))throw new Error('Bases educacionais sem retorno');
  out.source='IBGE + INEP (Observatório Sebrae / IBGE Cidades) + IPS Brasil como contingência';
  return out;
}

function latestSeriesValue(text,labelRx){
  const m=String(text||'').match(labelRx);if(!m)return null;
  const start=m.index+m[0].length,seg=String(text).slice(start,start+16000),rows=[];
  for(const z of seg.matchAll(/(0?[1-9]|1[0-2])\/(20\d{2})\s*\|\s*([0-9][0-9.]*)/g)){
    const month=Number(z[1]),year=Number(z[2]),value=num(z[3]);
    if(finite(value))rows.push({month,year,key:year*100+month,value:Number(value)});
  }
  rows.sort((x,y)=>y.key-x.key);return rows[0]||null;
}
async function cadunicoVisData(m){
  try{
    const uf=String(m.ibge).slice(0,2),code6=String(m.ibge).slice(0,6);
    const url=`https://aplicacoes.cidadania.gov.br/vis/data3/v.php?vsc=Sp8th1&ag=e&sag=${uf}&codigo=${code6}`;
    const text=plainPageText(await fetchText(url,30000));
    if(m.nome && !clean(text).includes(clean(m.nome)))return null;
    const poverty=latestSeriesValue(text,/Número de famílias cadastradas no Cadastro Único em situação de pobreza[^]*?Referência\s*\|/i);
    const low=latestSeriesValue(text,/Número de famílias cadastradas no Cadastro Único com renda per capita de até meio salário-mínimo[^]*?Referência\s*\|/i);
    const above=latestSeriesValue(text,/Número de famílias cadastradas no Cadastro Único com renda per capita acima de meio salário-mínimo[^]*?Referência\s*\|/i);
    const ref=[poverty,low,above].filter(Boolean).sort((x,y)=>y.key-x.key)[0]||null;
    const families=(low&&above&&low.key===above.key)?low.value+above.value:null;
    if(!finite(families)&&!finite(low?.value)&&!finite(poverty?.value))return null;
    return {families:safe(families),people:null,lowIncome:safe(low?.value),poverty:safe(poverty?.value),street:null,source:'MDS · VIS DATA 3 / Cadastro Único',reference:ref?`${String(ref.month).padStart(2,'0')}/${ref.year}`:''};
  }catch{return null}
}
getCadunico=async function(m){
  const urls=[];
  for(const code of [m.ibge,m.ibge.slice(0,6)]){
    urls.push(`https://aplicacoes.mds.gov.br/sagi/RIv3/geral/index.php?codigo=${code}`);
    urls.push(`https://aplicacoes.cidadania.gov.br/ri/ri/relatorios/cidadania/?codigo=${code}`);
  }
  let text='';
  for(const raw of urls){
    for(const u of [raw,`https://r.jina.ai/${raw}`]){
      try{const t=await fetchText(u,22000);if(t&&t.length>1800){text=t;break}}catch{}
    }
    if(text)break;
  }
  if(!text){const vis=await cadunicoVisData(m);if(vis)return vis;throw new Error('Cadastro Único: fonte municipal sem leitura automática');}
  const families=findTextNumber(text,[/(?:fam[ií]lias)[^\d]{0,120}(?:cadastrad|inscrit)[^\d]{0,40}([\d\.]+)/i,/([\d\.]+)\s*fam[ií]lias[^\n]{0,100}cadastro [uú]nico/i]);
  const people=findTextNumber(text,[/(?:pessoas)[^\d]{0,120}(?:cadastrad|inscrit)[^\d]{0,40}([\d\.]+)/i,/([\d\.]+)\s*pessoas[^\n]{0,100}cadastro [uú]nico/i]);
  const low=findTextNumber(text,[/(?:baixa renda|pobreza)[^\d]{0,120}([\d\.]+)\s*(?:fam[ií]lias|pessoas)/i,/([\d\.]+)\s*(?:fam[ií]lias|pessoas)[^\n]{0,120}(?:baixa renda|pobreza)/i]);
  const street=findTextNumber(text,[/(?:situa[cç][aã]o de rua)[^\d]{0,120}([\d\.]+)\s*(?:pessoas|fam[ií]lias)/i,/([\d\.]+)\s*(?:pessoas|fam[ií]lias)[^\n]{0,120}(?:situa[cç][aã]o de rua)/i]);
  if(![families,people,low,street].some(finite)){const vis=await cadunicoVisData(m);if(vis)return vis;throw new Error('Cadastro Único: página respondeu, mas sem indicadores estruturados');}
  return {families:safe(families),people:safe(people),lowIncome:safe(low),street:safe(street),source:'MDS · RI Social / SAGICAD'};
}
getBudget=async function(m){
  let items=[],year=null,reference='';
  for(const y of [2025,2024,2023,2022,2021]){
    try{const u=new URL('https://apidatalake.tesouro.gov.br/ords/siconfi/tt/dca');u.searchParams.set('an_exercicio',y);u.searchParams.set('no_anexo','DCA-Anexo I-E');u.searchParams.set('id_ente',m.ibge);const d=await fetchJson(u,30000);if(Array.isArray(d?.items)&&d.items.length){items=d.items;year=y;reference=`DCA ${y} · despesas liquidadas`;break}}catch{}
  }
  if(!items.length)throw new Error('SICONFI sem DCA encontrado');
  const fnValues=[];for(let i=1;i<=99;i++){const v=dcaValue(items,String(i).padStart(2,'0'));if(finite(v))fnValues.push(Number(v))}
  const total=fnValues.length?fnValues.reduce((a,b)=>a+b,0):NaN;
  const assist=dcaValue(items,'08'),health=dcaValue(items,'10'),education=dcaValue(items,'12'),sub=c=>dcaValue(items,c),sum=(...v)=>{const a=v.filter(finite);return a.length?a.reduce((x,y)=>x+Number(y),0):NaN};
  const env=['18.541','18.542','18.543','18.544'].map(sub).filter(finite);
  return {year,reference,total:safe(total),assist:safe(assist),health:safe(health),education:safe(education),child:safe(sub('08.243')),elderly:safe(sub('08.241')),community:safe(sub('08.244')),work:safe(sum(sub('11.333'),sub('11.334'))),qualification:safe(sum(sub('12.363'),sub('11.333'))),apprentice:safe(sum(sub('12.363'),sub('11.333'))),digital:safe(sub('04.126')),care:safe(sum(sub('08.241'),sub('08.244'))),environment:safe(env.length?env.reduce((a,b)=>a+b,0):NaN),entrepreneur:safe(sum(sub('11.334'),sub('23.691'))),source:'SICONFI / Tesouro Nacional'};
}

async function settled(name, fn, label) {
  try {
    const data=await fn();
    return {
      name,
      data,
      source:{status:'ok',label,reference:data?.reference||data?.source||'',message:'Dados carregados pela API integrada.'}
    };
  } catch (e) {
    return {
      name,
      data:null,
      source:{status:'bad',label,reference:'',message:e?.message||'Fonte indisponível'}
    };
  }
}
async function diagnostic(m) {
  const jobs=await Promise.all([
    settled('ivcad',()=>getIvcad(m),'IVCAD / Cadastro Único'),
    settled('education',()=>getEducation(m),'IBGE + INEP'),
    settled('mse',()=>getMse(m),'RMA CREAS / MDS'),
    settled('popRua',()=>getPopRua(m),'RMA Centro POP / MDS'),
    settled('suas',()=>getSuas(m),'RMA / MDS'),
    settled('cadunico',()=>getCadunico(m),'RI Social / MDS'),
    settled('budget',()=>getBudget(m),'SICONFI / Tesouro Nacional')
  ]);
  const data={}, sources={};
  for (const j of jobs) { data[j.name]=j.data; sources[j.name]=j.source; }

  if (data.ivcad && Object.values(data.ivcad.dims||{}).filter(finite).length<6) {
    sources.ivcad.status='partial';
    sources.ivcad.message='Índice geral disponível; as seis dimensões dependem de fonte estruturada do Observatório ou conector próprio.';
  }
  if (data.education && !finite(data.education.enrollments) && !finite(data.education.idebInitial)) {
    sources.education.status='partial';
    sources.education.message='Apenas parte dos indicadores educacionais respondeu.';
  }

  return {
    ok:true,
    version:'1.2.1',
    municipio:{codigoIBGE:m.ibge,nome:m.nome,uf:m.uf},
    generatedAt:new Date().toISOString(),
    cacheTtlSeconds:CACHE_TTL/1000,
    sources,
    data
  };
}

const server=http.createServer(async (req,res) => {
  try {
    if (req.method==='OPTIONS') {
      res.writeHead(204,{
        'access-control-allow-origin':'*',
        'access-control-allow-methods':'GET,OPTIONS',
        'access-control-allow-headers':'content-type'
      });
      return res.end();
    }

    const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);

    if (u.pathname==='/' || u.pathname==='/api/health') {
      return json(res,200,{
        ok:true,
        service:'Diagnóstico Territorial Integrado · Rede Cidadã',
        version:'1.2.1',
        endpoints:['/api/health','/api/diagnostico/{codigoIBGE}','/api/ivcad/{codigoIBGE}'],
        time:new Date().toISOString()
      });
    }

    const match=u.pathname.match(/^\/api\/(diagnostico|ivcad)\/(\d{7})$/);
    if (!match) return json(res,404,{error:'Rota não encontrada'});

    const [,type,ibge]=match;
    const m=await municipality(ibge,u.searchParams.get('nome')||'',u.searchParams.get('uf')||'');
    const key=`diag:${ibge}`;
    const hit=cache.get(key);
    let bundle;

    if (hit && Date.now()-hit.at<CACHE_TTL && u.searchParams.get('refresh')!=='1') bundle=hit.value;
    else {
      bundle=await diagnostic(m);
      cache.set(key,{at:Date.now(),value:bundle});
    }

    if (type==='ivcad') {
      if (!bundle.data.ivcad) return json(res,503,{error:'IVCAD indisponível',status:bundle.sources.ivcad});
      return json(res,200,{
        ...bundle.data.ivcad,
        fonte:bundle.data.ivcad.source,
        referencia:bundle.data.ivcad.reference
      });
    }

    return json(res,200,bundle);
  } catch (e) {
    return json(res,500,{error:'Falha interna',detail:e?.message||String(e)});
  }
});

server.listen(PORT,'0.0.0.0',() => {
  console.log(`Diagnóstico Territorial ativo na porta ${PORT}`);
});
