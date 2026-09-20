from __future__ import annotations
import json, re, shutil, subprocess, tempfile, unicodedata, urllib.request
from pathlib import Path
import pandas as pd

SOURCES = {
    "cras":"https://aplicacoes.mds.gov.br/sagi/dicivip_datain/ckfinder/userfiles/files/1_CRAS%283%29.rar",
    "creas":"https://aplicacoes.mds.gov.br/sagi/dicivip_datain/ckfinder/userfiles/files/2_CREAS%281%29.rar",
    "centroPop":"https://aplicacoes.mds.gov.br/sagi/dicivip_datain/ckfinder/userfiles/files/3_CENTRO%20POP%285%29.rar",
    "convivencia":"https://aplicacoes.mds.gov.br/sagi/dicivip_datain/ckfinder/userfiles/files/5%20-%20CENTRO%20DE%20CONVIVENCIA%284%29.rar",
    "centroDia":"https://aplicacoes.mds.gov.br/sagi/dicivip_datain/ckfinder/userfiles/files/6_CENTRO%20DIA%281%29.rar",
}
OUT=Path("data/snapshots/suas.json")

def norm(v):
    s="" if v is None else str(v)
    s=unicodedata.normalize("NFD",s)
    return "".join(c for c in s if unicodedata.category(c)!="Mn").lower().strip()

def fetch(url,path):
    req=urllib.request.Request(url,headers={"User-Agent":"RedeCidada-Snapshot/1.0"})
    with urllib.request.urlopen(req,timeout=180) as r, open(path,"wb") as f:
        shutil.copyfileobj(r,f)

def frames(path):
    ext=path.suffix.lower()
    try:
        if ext==".csv":
            for sep in ["; ", ";", ",", "\t"]:
                try:
                    df=pd.read_csv(path,sep=sep,encoding="utf-8",dtype=str,engine="python")
                    if df.shape[1]>1: return [("csv",df)]
                except Exception: pass
            try:return [("csv",pd.read_csv(path,sep=";",encoding="latin1",dtype=str))]
            except Exception:return []
        if ext in {".xlsx",".xls"}:
            book=pd.read_excel(path,sheet_name=None,dtype=str)
            return list(book.items())
    except Exception:
        return []
    return []

def find_col(cols,needles):
    for c in cols:
        n=norm(c).replace("_"," ")
        if any(x in n for x in needles): return c
    return None

def code_from(v):
    d=re.sub(r"\D","",str(v or ""))
    if len(d)>=7:return d[:7]
    if len(d)==6:return d
    return ""

result={}
with tempfile.TemporaryDirectory() as td:
    td=Path(td)
    for kind,url in SOURCES.items():
        arc=td/(kind+".rar");dest=td/kind;dest.mkdir()
        fetch(url,arc)
        subprocess.run(["7z","x","-y",str(arc),"-o"+str(dest)],check=True,stdout=subprocess.DEVNULL)
        best={}
        for file in dest.rglob("*"):
            if file.suffix.lower() not in {".csv",".xlsx",".xls"}: continue
            for sheet,df in frames(file):
                if df.empty: continue
                cols=list(df.columns)
                ccode=find_col(cols,["ibge","cod mun","codigo mun","cod_mun"])
                cname=find_col(cols,["municipio","município","nome mun"])
                cid=find_col(cols,["nu identificador","identificador","id unidade","codigo unidade","cod unidade"])
                if not ccode and not cname: continue
                local={}
                for idx,row in df.iterrows():
                    code=code_from(row.get(ccode)) if ccode else ""
                    if len(code)!=7: continue
                    uid=str(row.get(cid) or "").strip() if cid else str(idx)
                    local.setdefault(code,set()).add(uid)
                for code,ids in local.items():
                    best[code]=max(best.get(code,0),len(ids))
        for code,count in best.items():
            result.setdefault(code,{"reference":"Censo SUAS 2024","source":"MDS · Censo SUAS 2024"})[kind]=count

OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
print(f"{len(result)} municípios gravados em {OUT}")
