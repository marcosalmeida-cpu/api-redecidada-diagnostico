#!/usr/bin/env python3
from __future__ import annotations
import csv, io, json, re, unicodedata, urllib.request, zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

NBF_BASE="https://portaldatransparencia.gov.br/download-de-dados/novo-bolsa-familia/"
BPC_BASE="https://portaldatransparencia.gov.br/download-de-dados/bpc/"
IBGE="https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36"

def norm(s):
    s="" if s is None else str(s)
    s=unicodedata.normalize("NFD",s)
    s="".join(c for c in s if unicodedata.category(c)!="Mn").lower().strip()
    return re.sub(r"[^a-z0-9]+"," ",s).strip()

def fetch(url, timeout=180):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"*/*"})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return r.read()

def month_candidates(n=12):
    y,m=date.today().year,date.today().month
    out=[]
    for _ in range(n):
        out.append(f"{y}{m:02d}")
        m-=1
        if m==0: y,m=y-1,12
    return out

def latest_zip(base):
    for ym in month_candidates(14):
        url=base+ym
        try:
            raw=fetch(url)
            if raw[:4] in (b"PK\x03\x04",b"PK\x05\x06"):
                return ym,raw,url
        except Exception as e:
            print("MISS",url,type(e).__name__)
    return None,None,None

def ibge_map():
    data=json.loads(fetch(IBGE,60).decode("utf-8"))
    by_name={}
    for m in data:
        uf=(m.get("microrregiao") or {}).get("mesorregiao",{}).get("UF",{}).get("sigla")
        if not uf:
            uf=(((m.get("regiao-imediata") or {}).get("regiao-intermediaria") or {}).get("UF") or {}).get("sigla")
        if uf:
            by_name[(uf.upper(),norm(m.get("nome")))]=str(m.get("id"))
    return by_name

def decode_csv(raw):
    for enc in ("utf-8-sig","latin-1","cp1252"):
        try:
            return raw.decode(enc)
        except: pass
    return raw.decode("latin-1",errors="replace")

def rows_from_zip(raw):
    z=zipfile.ZipFile(io.BytesIO(raw))
    members=[n for n in z.namelist() if n.lower().endswith((".csv",".txt"))]
    if not members: return
    for name in members:
        text=decode_csv(z.read(name))
        sample=text[:8000]
        delim=";" if sample.count(";")>=sample.count(",") else ","
        reader=csv.DictReader(io.StringIO(text),delimiter=delim)
        for row in reader:
            yield {norm(k):v for k,v in row.items() if k is not None}

def val(row,*aliases):
    for a in aliases:
        k=norm(a)
        if k in row and str(row[k]).strip():
            return str(row[k]).strip()
    return ""

def key_for(row,by_name):
    uf=val(row,"UF").upper()
    city=val(row,"NOME MUNICÍPIO","NOME MUNICIPIO","MUNICÍPIO","MUNICIPIO")
    return by_name.get((uf,norm(city)))

def aggregate_nbf(raw,by_name):
    ids=defaultdict(set)
    for row in rows_from_zip(raw):
        ibge=key_for(row,by_name)
        if not ibge: continue
        ident=(val(row,"NIS FAVORECIDO","NIS BENEFICIÁRIO","NIS BENEFICIARIO")
               or val(row,"CPF FAVORECIDO","CPF BENEFICIÁRIO","CPF BENEFICIARIO")
               or val(row,"NOME FAVORECIDO","NOME BENEFICIÁRIO","NOME BENEFICIARIO"))
        if ident: ids[ibge].add(ident)
    return {k:len(v) for k,v in ids.items()}

def aggregate_bpc(raw,by_name):
    ids=defaultdict(set)
    for row in rows_from_zip(raw):
        ibge=key_for(row,by_name)
        if not ibge: continue
        ident=(val(row,"NÚMERO BENEFÍCIO","NUMERO BENEFICIO","Nº BENEFÍCIO","NO BENEFICIO")
               or val(row,"NIS BENEFICIÁRIO","NIS BENEFICIARIO")
               or val(row,"CPF BENEFICIÁRIO","CPF BENEFICIARIO")
               or val(row,"NOME BENEFICIÁRIO","NOME BENEFICIARIO"))
        if ident: ids[ibge].add(ident)
    return {k:len(v) for k,v in ids.items()}

def main():
    out=Path("data/snapshots/beneficios_sociais.json")
    out.parent.mkdir(parents=True,exist_ok=True)
    old={}
    if out.exists():
        try: old=json.loads(out.read_text(encoding="utf-8"))
        except: old={}
    old.pop("__meta__",None)

    by_name=ibge_map()
    nbf_ym,nbf_raw,nbf_url=latest_zip(NBF_BASE)
    bpc_ym,bpc_raw,bpc_url=latest_zip(BPC_BASE)
    print("NBF",nbf_ym,nbf_url)
    print("BPC",bpc_ym,bpc_url)
    nbf=aggregate_nbf(nbf_raw,by_name) if nbf_raw else {}
    bpc=aggregate_bpc(bpc_raw,by_name) if bpc_raw else {}

    keys=set(old)|set(nbf)|set(bpc)
    data={}
    for k in keys:
        rec=dict(old.get(k) or {})
        if k in nbf:
            rec["bolsaFamiliaPaidRecipients"]=nbf[k]
            rec["bolsaFamiliaPaidRecipientsReference"]=nbf_ym
            rec["bolsaFamiliaPaidRecipientsSource"]="CGU · Portal da Transparência · Novo Bolsa Família"
        if k in bpc:
            rec["bpcTotal"]=bpc[k]
            rec["bpcReference"]=bpc_ym
            rec["bpcBasis"]="benefícios BPC pagos no município do beneficiário"
            rec["bpcSource"]="CGU · Portal da Transparência"
        data[k]=rec

    meta={"novoBolsaFamilia":nbf_ym,"bpc":bpc_ym,"municipiosNBF":len(nbf),"municipiosBPC":len(bpc)}
    out.write_text(json.dumps({"__meta__":meta,**data},ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(json.dumps(meta,ensure_ascii=False))

if __name__=="__main__":
    main()
