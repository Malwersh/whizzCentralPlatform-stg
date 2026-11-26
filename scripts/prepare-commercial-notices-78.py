"""Overlay only notice-related modules over captured live packages. Backends stay closed financially."""
import pathlib,json,zipfile,copy,hashlib,base64,subprocess
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing78')
changes={
 'staff':{'index.js':R/'backend/staff-service/index.js','commercial-management.js':R/'backend/staff-service/commercial-management.js','commercial-notices.js':O/'commercial-notices.js'},
 'push':{'src/handlers/push-merchant-order.js':O/'push-merchant-order.js','src/utils/commercial-sharing-push.js':O/'commercial-sharing-push.js'},
 'worker':{'commercial-retention.js':R/'backend/account-deletion/commercial-retention.js'},
 'expiry':{'commercial-retention.js':R/'backend/account-deletion/commercial-retention.js'}}
with zipfile.ZipFile(O/'push.base.zip') as z:
 original=z.read('src/handlers/push-merchant-order.js').decode();anchor='exports.sendMerchantOrder = async (event) => {';assert original.count(anchor)==1;(O/'push-merchant-order.js').write_text(original.replace(anchor,anchor+"\n  if(event?.action==='commercial_notice'&&!event.httpMethod&&!event.requestContext)return require('../utils/commercial-sharing-push').send(event,{db:dynamodb,getMessaging,tokensTable:TOKENS_TABLE});"))
report={}
for key,files in changes.items():
 with zipfile.ZipFile(O/(key+'.base.zip')) as old:
  if key=='staff':assert old.read('index.js').decode()==files['index.js'].read_text().replace(" if(event?.action==='commercial_notice_tick'&&!event.httpMethod&&!event.requestContext)return require('./commercial-notices').tick({db});\n",''),'INDEX_DRIFT'
  if key=='push':assert old.read('src/handlers/push-merchant-order.js').decode()==files['src/handlers/push-merchant-order.js'].read_text().replace("  if(event?.action==='commercial_notice'&&!event.httpMethod&&!event.requestContext)return require('../utils/commercial-sharing-push').send(event,{db:dynamodb,getMessaging,tokensTable:TOKENS_TABLE});\n",''),'PUSH_HANDLER_DRIFT'
  with zipfile.ZipFile(O/(key+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED) as out:
   for info in old.infolist():out.writestr(copy.copy(info),files[info.filename].read_bytes() if info.filename in files else old.read(info.filename))
   for name,path in files.items():
    if name not in old.namelist():out.writestr(name,path.read_bytes())
  with zipfile.ZipFile(O/(key+'.candidate.zip')) as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in files)
 report[key]={'changedFiles':list(files),'codeSha256':base64.b64encode(hashlib.sha256((O/(key+'.candidate.zip')).read_bytes()).digest()).decode()}
(O/'preparation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
