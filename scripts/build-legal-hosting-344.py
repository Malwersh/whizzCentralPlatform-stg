"""Prepare an additive legal CMS deployment while preserving every unrelated hosted file."""
import pathlib,zipfile,copy,json,hashlib,sys
root=pathlib.Path(__file__).resolve().parents[1];folder=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/private/tmp/customer-legal-344')
with zipfile.ZipFile(folder/'hosting-base.zip') as base:
 name=next(n for n in base.namelist() if n=='pages/settings.html');html=base.read(name).decode();anchor='<h1>الإعدادات</h1>';assert html.count(anchor)==1
 source=(root/'frontend/pages/settings.html').read_text();start=source.index('<section id="customer-legal-settings">');end=source.index('</section>',start)+len('</section>');section=source[start:end];assert 'customer-legal-settings' not in html
 changes={name:html.replace(anchor,anchor+section,1).encode()}
 for n in ['pages/legal-documents.html','customer-legal-settings-344.js','assets/brand/wizz-primary.png']:changes[n]=(root/'frontend'/n).read_bytes()
 with zipfile.ZipFile(folder/'hosting-legal-344.zip','w',compression=zipfile.ZIP_DEFLATED) as out:
  for item in base.infolist():out.writestr(copy.copy(item),changes.get(item.filename,base.read(item.filename)))
  for n,r in changes.items():
   if n not in base.namelist():out.writestr(n,r)
 with zipfile.ZipFile(folder/'hosting-legal-344.zip') as out:
  for n in base.namelist():
   if n not in changes:assert out.read(n)==base.read(n),n
manifest={'status':'BUILT_NOT_PUBLISHED','changes':list(changes),'allUnrelatedEntriesIdentical':True,'hashes':{n:hashlib.sha256(r).hexdigest() for n,r in changes.items()}}
(folder/'hosting-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
