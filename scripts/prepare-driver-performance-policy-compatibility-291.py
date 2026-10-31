"""Local-only enum compatibility; no policy write or deployment."""
from pathlib import Path
import json,zipfile,hashlib,base64,copy,re,subprocess
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-projection-291');captured=json.loads((P/'policy-readers.json').read_text());reports=[]
pattern=r'\b(\w+)\.performanceMode\s*!==\s*[\'\"]LEGACY_METRICS[\'\"]'
for item in captured:
 if not item['files']:continue
 name=item['function'];q=P/name;cfg=json.loads((q/'config.private.json').read_text());base=q/'base.zip';assert base64.b64encode(hashlib.sha256(base.read_bytes()).digest()).decode()==cfg['CodeSha256'];z=zipfile.ZipFile(base);changes={}
 for hit in item['files']:
  n=hit['file'];s=z.read(n).decode();s,count=re.subn(pattern,lambda m:'!["LEGACY_METRICS","VERIFIED_SNAPSHOT_V1"].includes('+m.group(1)+'.performanceMode)',s);assert count==hit['checks'];changes[n]=s.encode()
 candidate=q/'candidate.zip'
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 new=zipfile.ZipFile(candidate);assert all(new.read(n)==z.read(n)for n in z.namelist()if n not in changes)
 for n,data in changes.items():
  f=q/('check-'+n.replace('/','_'));f.write_bytes(data);subprocess.run(['node','--check',str(f)],check=True)
 reports.append({'function':name,'baseHash':cfg['CodeSha256'],'revision':cfg['RevisionId'],'candidateHash':base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode(),'changedFiles':list(changes),'roleArn':cfg['Role'],'configurationChanged':False,'deployed':False,'scope':'Allow only the new explicit performance source enum; financial computations unchanged'})
(R/'docs/driver-performance-policy-compatibility-packages-291.json').write_text(json.dumps({'status':'PREPARED_NOT_DEPLOYED','functions':reports},indent=2)+'\n');print(json.dumps([{'function':r['function'],'files':len(r['changedFiles'])}for r in reports]))
