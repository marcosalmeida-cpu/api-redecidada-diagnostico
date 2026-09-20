#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, re, time, unicodedata, urllib.request
from pathlib import Path
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

OBS="https://paineis.mds.gov.br/public/extensions/observatorio-do-cadastro-unico/index.html"
IBGE="https://servicodados.ibge.gov.br/api/v1/localidades/estados/{uf}/municipios?orderBy=nome"

def norm(s):
    s="" if s is None else str(s)
    s=unicodedata.normalize("NFD",s)
    return "".join(c for c in s if unicodedata.category(c)!="Mn").lower().strip()

def fetch_json(url):
    req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
    with urllib.request.urlopen(req,timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def brnum(s):
    if s is None: return None
    t=str(s).strip().replace("R$","").replace(" ","")
    if t in {"","-","—","n/d","N/D"}: return None
    if re.fullmatch(r"-?\d{1,3}(?:\.\d{3})+(?:,\d+)?",t):
        t=t.replace(".","").replace(",",".")
    elif re.fullmatch(r"-?\d+(?:,\d+)",t):
        t=t.replace(",",".")
    else:
        t=re.sub(r"[^0-9.\-]","",t)
    try: return float(t)
    except: return None

def nearest_number(lines,patterns,window=5):
    pats=[re.compile(p,re.I) for p in patterns]
    for i,line in enumerate(lines):
        nline=norm(line)
        if any(p.search(nline) for p in pats):
            for j in range(i,min(len(lines),i+window+1)):
                for token in re.findall(r"(?<!\d)(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?%?",lines[j]):
                    v=brnum(token.replace("%",""))
                    if v is not None:
                        return v
    return None

def parse_visible_text(text):
    lines=[x.strip() for x in text.splitlines() if x.strip()]
    d={}
    d["families"]=nearest_number(lines,[r"fam[ií]lias cadastradas",r"total de fam[ií]lias"])
    d["bolsaFamiliaFamilies"]=nearest_number(lines,[r"fam[ií]lias.*bolsa fam[ií]lia",r"benefici[aá]rias.*bolsa fam[ií]lia"])
    d["bpcTotal"]=nearest_number(lines,[r"benefici[aá]rios.*bpc.*cadastro",r"bpc.*cadastro [uú]nico"])
    d["pcdFamilies"]=nearest_number(lines,[r"fam[ií]lia.*pessoa.*defici[eê]ncia"])
    d["singlePersonFamilies"]=nearest_number(lines,[r"fam[ií]lias unipessoais",r"fam[ií]lia.*uma pessoa"])
    d["streetFamilies"]=nearest_number(lines,[r"fam[ií]lia.*situa[cç][aã]o de rua"])
    d["gpteFamilies"]=nearest_number(lines,[r"grupos populacionais tradicionais",r"\bgpte\b"])
    d["updatedFamilies"]=nearest_number(lines,[r"cadastro atualizado",r"atualizad[oa].*24 meses"])
    d["povertyFamilies"]=nearest_number(lines,[r"fam[ií]lia.*situa[cç][aã]o de pobreza"])
    return {k:v for k,v in d.items() if v is not None}

def accept_terms(page):
    for frame in page.frames:
        for label in ["Prosseguir","Desativar filtro e prosseguir","Aceito","Concordo","Continuar"]:
            try:
                loc=frame.get_by_role("button",name=re.compile(label,re.I))
                if loc.count() and loc.first.is_visible():
                    loc.first.click(timeout=2000)
                    time.sleep(1)
                    return
            except: pass

def select_by_capability(page,code):
    js=r"""async (code) => {
      function reqQlik(){
        return new Promise(resolve=>{
          if(!window.require) return resolve(null);
          try{ window.require(["js/qlik"], q=>resolve(q), ()=>resolve(null)); }catch(e){resolve(null)}
        });
      }
      const qlik=await reqQlik();
      if(!qlik) return {ok:false,reason:"qlik_require_unavailable"};
      let app=null;
      try{ app=qlik.currApp(); }catch(e){}
      if(!app){
        try{
          const g=qlik.getGlobal();
          const apps=await new Promise(resolve=>g.getAppList(x=>resolve(x||[])));
          if(apps.length) app=qlik.openApp(apps[0].qDocName);
        }catch(e){}
      }
      if(!app) return {ok:false,reason:"app_unavailable"};
      const items=await new Promise(resolve=>{
        try{ app.getList("FieldList",r=>resolve(r?.qFieldList?.qItems||[])); }catch(e){resolve([])}
      });
      const names=items.map(x=>x.qName).filter(Boolean);
      const score=n=>{
        const s=String(n).toLowerCase();
        let x=0;if(s.includes("ibge"))x+=5;if(s.includes("mun"))x+=3;if(s.includes("cod"))x+=2;return x;
      };
      names.sort((a,b)=>score(b)-score(a));
      const field=names.find(n=>score(n)>=5);
      if(!field) return {ok:false,reason:"ibge_field_not_found",fields:names.filter(n=>/ibge|munic/i.test(n)).slice(0,20)};
      try{await app.clearAll()}catch(e){}
      try{
        const f=app.field(field);
        try{await f.selectValues([{qText:String(code)}],false,true)}
        catch(e){await f.selectMatch(String(code),false)}
        return {ok:true,field};
      }catch(e){return {ok:false,reason:String(e),field}}
    }"""
    try:
        return page.evaluate(js,str(code))
    except Exception as e:
        return {"ok":False,"reason":str(e)}

def select_by_ui(page,code):
    try:
        txt=page.get_by_text(re.compile("lista de c[oó]digos IBGE",re.I))
        if txt.count(): txt.first.click(timeout=2000)
    except: pass
    time.sleep(.5)
    for frame in page.frames:
        for sel in ["textarea:visible","input:visible"]:
            loc=frame.locator(sel)
            for i in range(min(loc.count(),12)):
                el=loc.nth(i)
                try:
                    ph=norm(el.get_attribute("placeholder") or "")
                    if "ibge" in ph or sel.startswith("textarea"):
                        el.fill(str(code),timeout=1500)
                        btn=frame.get_by_role("button",name=re.compile("^Filtrar$|Aplicar",re.I))
                        if btn.count():
                            btn.first.click(timeout=2000)
                            time.sleep(1.3)
                            return True
                except: pass
    return False

def section_text(page,label):
    try:
        loc=page.get_by_text(re.compile(label,re.I))
        if loc.count():
            loc.first.click(timeout=2500)
            time.sleep(.8)
    except: pass
    try: return page.locator("body").inner_text(timeout=5000)
    except: return ""

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--uf",required=True)
    ap.add_argument("--output",required=True)
    ap.add_argument("--limit",type=int,default=0)
    args=ap.parse_args()
    uf=args.uf.upper()
    outp=Path(args.output)
    outp.parent.mkdir(parents=True,exist_ok=True)
    old={}
    if outp.exists():
        try: old=json.loads(outp.read_text(encoding="utf-8"))
        except: old={}
    cities=fetch_json(IBGE.format(uf=uf))
    if args.limit: cities=cities[:args.limit]
    data={k:v for k,v in old.items() if not str(k).startswith("__")}
    meta={"uf":uf,"updatedAt":datetime.now(timezone.utc).isoformat(),"source":OBS,"attempted":0,"updated":0,"failed":0}

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=["--disable-dev-shm-usage","--no-sandbox"])
        ctx=browser.new_context(locale="pt-BR",viewport={"width":1440,"height":1000})
        page=ctx.new_page()
        page.goto(OBS,wait_until="domcontentloaded",timeout=90000)
        time.sleep(5)
        accept_terms(page)
        time.sleep(3)

        for idx,city in enumerate(cities,1):
            code=str(city["id"])
            meta["attempted"]+=1
            try:
                sel=select_by_capability(page,code)
                if not sel.get("ok"):
                    if not select_by_ui(page,code):
                        raise RuntimeError("municipality_selection_failed: "+json.dumps(sel,ensure_ascii=False))
                time.sleep(1.2)
                chunks=[]
                for label in ["Características das famílias","Benefícios Sociais","Pessoas com deficiência","População em situação de rua 1","GPTE","Tabela"]:
                    t=section_text(page,label)
                    if t: chunks.append(t)
                merged="\n".join(chunks)
                metrics=parse_visible_text(merged)
                if metrics:
                    metrics["municipio"]=city.get("nome")
                    metrics["uf"]=uf
                    metrics["codigoIBGE"]=code
                    metrics["source"]="MDS · Observatório do Cadastro Único"
                    metrics["reference"]="painel público"
                    metrics["scrapedAt"]=datetime.now(timezone.utc).isoformat()
                    data[code]={**data.get(code,{}),**metrics}
                    meta["updated"]+=1
                else:
                    meta["failed"]+=1
            except Exception as e:
                meta["failed"]+=1
                print(f"[{uf}] {code} {city.get('nome')}: {e}")
            time.sleep(.35)
            if idx%50==0:
                print(f"[{uf}] {idx}/{len(cities)} updated={meta['updated']} failed={meta['failed']}")
        browser.close()

    final={"__meta__":meta,**data}
    outp.write_text(json.dumps(final,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(json.dumps(meta,ensure_ascii=False))

if __name__=="__main__":
    main()
