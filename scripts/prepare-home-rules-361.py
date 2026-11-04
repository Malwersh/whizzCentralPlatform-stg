from pathlib import Path
import json,subprocess,zipfile,copy,hashlib,base64
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/home-rules-361'
(P/'entry.cjs').write_text("const layout=require('../../staff-service/home-layout');const discovery=require('../../staff-service/home-discovery');module.exports={...layout,catalogRoute:discovery.route,rebuild:discovery.rebuild};\n")
# Entry is inside backend/.tmp/home-rules-361, so reach sibling backend/staff-service.
(P/'entry.cjs').write_text((P/'entry.cjs').read_text().replace("../../staff-service/","../../staff-service/"))
subprocess.run(['node','-e',"require('./backend/wallet-service/node_modules/esbuild').buildSync({entryPoints:['backend/.tmp/home-rules-361/entry.cjs'],bundle:true,platform:'node',target:'node22',format:'cjs',external:['@aws-sdk/lib-dynamodb'],outfile:'backend/.tmp/home-rules-361/home-rules-361.js'})"],cwd=R,check=True)
s=(P/'before-central.js').read_text();needle='async function handler(event) {';assert s.count(needle)==1;s=s.replace(needle,needle+'\n  if(event?.action==="home_discovery_tick"&&!event.httpMethod&&!event.requestContext)return require(process.env.LAMBDA_TASK_ROOT+"/home-rules-361.js").rebuild({db,table});',1)
needle='    if (path === "/staff/home-layout"';assert s.count(needle)==1;i=s.index(needle);s=s[:i]+'    if(path==="/staff/home-discovery/catalog")return response(200,await require(process.env.LAMBDA_TASK_ROOT+"/home-rules-361.js").catalogRoute({db,table,guard,audit},actor,method,input));\n'+s[i:]
assert s.count('"/home-layout-361.js"')==2;s=s.replace('"/home-layout-361.js"','"/home-rules-361.js"');needle='.feed(ctx,{signedIn,regionIds:ancestors})';assert s.count(needle)==1;s=s.replace(needle,'.feed(ctx,{signedIn,regionIds:ancestors,identity,customer,offerLive,eligibility:journey.eligibility,offerEnd:row=>offerInfo(row).endAt,layoutVersion:Number(event.queryStringParameters?.layoutVersion)||1})');(P/'candidate-central.js').write_text(s)
changes={'_discount_review/central-staff/index.js':s.encode(),'home-rules-361.js':(P/'home-rules-361.js').read_bytes()}
with zipfile.ZipFile(P/'before.zip') as z:
 with zipfile.ZipFile(P/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for f,data in changes.items():
   if f not in z.namelist():out.writestr(f,data)
 with zipfile.ZipFile(P/'candidate.zip') as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
c=json.loads((P/'config.private.json').read_text());m={'function':c['FunctionName'],'baseRevision':c['RevisionId'],'baseSha256':c['CodeSha256'],'candidateSha256':base64.b64encode(hashlib.sha256((P/'candidate.zip').read_bytes()).digest()).decode(),'changedFiles':list(changes),'allOtherEntriesPreserved':True};(P/'manifest.json').write_text(json.dumps(m,indent=2));print('Prepared rules runtime overlay with all other entries preserved')
