from pathlib import Path
import json,zipfile,subprocess,copy,hashlib,base64,re
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/driver-vehicles-308'
rows=json.loads((P/'captured.json').read_text());targets=[]
subprocess.run(['node',str(R/'scripts/prepare-driver-vehicles-308.cjs')],check=True)
def replace_functions(live,source,names):
 script="""const fs=require('fs'),ts=require(process.argv[1]);const [live,source,list]=process.argv.slice(2);const s=fs.readFileSync(live,'utf8'),a=ts.createSourceFile(live,s,99,true),next=fs.readFileSync(source,'utf8'),b=ts.createSourceFile(source,next,99,true),wanted=new Set(JSON.parse(list)),decl=new Map();function collect(n){if(ts.isFunctionDeclaration(n)&&n.name&&wanted.has(n.name.text))decl.set(n.name.text,n.getText(b));ts.forEachChild(n,collect);}collect(b);const edits=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.name&&wanted.has(n.name.text)){if(!decl.has(n.name.text))throw Error(n.name.text);edits.push([n.getStart(a),n.end,decl.get(n.name.text)]);return;}ts.forEachChild(n,visit);}visit(a);if(edits.length!==wanted.size)throw Error('Source/live function mismatch');let out=s;for(const[x,y,z]of edits.sort((a,b)=>b[0]-a[0]))out=out.slice(0,x)+z+out.slice(y);fs.writeFileSync(live,out);"""
 subprocess.run(['node','-e',script,str(R/'backend/wallet-service/node_modules/typescript'),str(live),str(source),json.dumps(names)],check=True)
for row in rows:
 p=P/row['name'];z=zipfile.ZipFile(p/'base.zip');changed={};details=[]
 work=p/'files';work.mkdir(exist_ok=True)
 for name in z.namelist():
  if not name.endswith('.js')or '/node_modules/'in '/'+name or name.startswith('node_modules/'):continue
  body=z.read(name)
  if b'function createStaging'in body and any(t in body for t in [b'function createStagingDriverOfferContext',b'function createStagingDispatchCandidates',b'function createStagingLegacyWaveExecutor',b'function createStagingLegacyResponses',b'function createStagingDriverOfferAcceptance',b'function createStagingDriverOfferStore']):
   f=work/name;f.parent.mkdir(exist_ok=True,parents=True);f.write_bytes(body)
   result=json.loads(subprocess.check_output(['node',str(R/'scripts/prepare-driver-vehicles-308.cjs'),str(f),name]))
   if result['functions']:changed[name]=Path(str(f)+'.patched').read_bytes();details.append({'file':name,**result})
 if changed:changed['driver-vehicles-runtime-308.js']=(P/'driver-vehicles-runtime-308.js').read_bytes()
 if row['name']=='DriversApi-staging':
  name='lambda_driver_api_v2.js';f=work/name;f.write_bytes(changed.get(name,z.read(name)))
  replace_functions(f,R.parent/'whizzDrivers-stg/backend/lambda_driver_api_v2.js',['getDriverInfo','getDriverProfile','updateDriverProfile','uploadDriverDocument','startSearching','getProfileStatus','isProfileComplete'])
  s=f.read_text();source=(R.parent/'whizzDrivers-stg/backend/lambda_driver_api_v2.js').read_text();a=source.index("    if (path.endsWith('/driver/vehicles')");b=source.index('    // Route handling',a);assert '    // Route handling'in s;s=s.replace('    // Route handling',source[a:b]+'    // Route handling',1);changed[name]=s.encode();changed['driver-vehicles-308.js']=(R/'backend/shared/driver-vehicles-308.js').read_bytes()
 if row['name']=='staging-wizz-staff-service':
  name='_discount_review/central-staff/index.js';f=work/name;f.parent.mkdir(exist_ok=True,parents=True);f.write_bytes(changed.get(name,z.read(name)))
  subprocess.run(['node',str(R/'scripts/patch-staff-vehicles-308.cjs'),str(f)],check=True);changed[name]=f.read_bytes()
  changed['driver-vehicles.js']=(R/'backend/staff-service/driver-vehicles.js').read_bytes().replace(b"require('../shared/driver-vehicles-308')",b"require('./driver-vehicles-core-308')")
  changed['driver-vehicles-core-308.js']=(R/'backend/shared/driver-vehicles-308.js').read_bytes()
 if not changed:raise AssertionError('No update found '+row['name'])
 for name,body in changed.items():
  f=work/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(body);subprocess.run(['node','--check',str(f)],check=True)
 target=p/'candidate.zip'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changed.get(info.filename,z.read(info.filename)))
  for name,body in changed.items():
   if name not in z.namelist():out.writestr(name,body)
 zz=zipfile.ZipFile(target);assert all(z.read(n)==zz.read(n)for n in z.namelist()if n not in changed)
 row.update(hash=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode(),changedFiles=list(changed),delegates=details,otherEntriesPreserved=True)
 print(row['name'],len(changed),'files',sum(len(d['functions'])for d in details),'delegates')
(P/'packages.json').write_text(json.dumps(rows,indent=2))
