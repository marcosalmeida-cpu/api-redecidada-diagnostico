'use strict';
let memo = null, loadedAt = 0;
async function getAll() {
  if (memo && Date.now() - loadedAt < 86400000) return memo;
  const r = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome', {
    signal: AbortSignal.timeout(16000), headers: {accept:'application/json'}
  });
  if (!r.ok || !(r.headers.get('content-type')||'').includes('json')) throw new Error('IBGE indisponível');
  const data = await r.json();
  if (!Array.isArray(data) || data.length < 5500) throw new Error('Lista municipal incompleta');
  memo = data.map(x => ({
    codigoIBGE: String(x.id), nome: x.nome,
    uf: x.microrregiao?.mesorregiao?.UF?.sigla || x['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla || ''
  })).filter(x => /^\d{7}$/.test(x.codigoIBGE) && x.uf);
  loadedAt = Date.now();
  return memo;
}
const normal = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
module.exports = async function handler(req,res) {
  if(req.method !== 'GET')return res.status(405).json({error:'Método não permitido'});
  const q=normal(req.query.q);
  if(q.length<2)return res.status(200).json({items:[],hint:'Digite pelo menos duas letras'});
  try {
    const list=await getAll();
    let items=list.filter(x=>normal(x.nome).startsWith(q) || x.codigoIBGE===q).slice(0,24);
    if(items.length<5)items=list.filter(x=>normal(x.nome).includes(q)||x.codigoIBGE===q).slice(0,24);
    res.setHeader('Cache-Control','public, s-maxage=3600');
    return res.status(200).json({items});
  }catch(e){return res.status(502).json({error:'A lista oficial de municípios não respondeu.'})}
};