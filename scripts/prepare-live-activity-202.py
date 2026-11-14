import boto3,pathlib,json,urllib.request,zipfile,hashlib,base64,copy
p=pathlib.Path('/private/tmp/live-activity-202');p.mkdir(exist_ok=True,mode=0o700);s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');rows=[]
for n in ['WaveSystem_CreateDispatchJob','wizzcentral-notifications-staging-pushSendOrderUpdate']:
 f=l.get_function(FunctionName=n);c=f['Configuration'];(p/(n+'.config.private.json')).write_text(json.dumps(c,default=str));(p/(n+'.original.zip')).write_bytes(urllib.request.urlopen(f['Code']['Location'],timeout=90).read())
 with zipfile.ZipFile(p/(n+'.original.zip')) as z:
  changes={}
  if n=='WaveSystem_CreateDispatchJob':
   name=c['Handler'].rsplit('.',1)[0]+'.js';text=z.read(name).decode();assert 'const lambda = new AWS.Lambda()' in text;assert 'dispatchWithoutActivity' not in text
   changes[name]=(text+'''\nconst dispatchWithoutActivity = exports.handler;
exports.handler = async (event, context) => {
 if (Array.isArray(event.Records)) await require('./order-activity-stream').forward(event, input => lambda.invoke(input).promise());
 return dispatchWithoutActivity(event, context);
};\n''').encode();changes['order-activity-stream.js']=pathlib.Path('backend/src/handlers/order-activity-stream.js').read_bytes()
  else:
   for source in ['push-order-update.js','live-activity-push.js']:
    name=next(k for k in z.namelist() if k.endswith('/'+source) or k==source);changes[name]=pathlib.Path('backend/src/handlers',source).read_bytes()
  with zipfile.ZipFile(p/(n+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED) as out:
   for e in z.infolist():out.writestr(copy.copy(e),changes.get(e.filename,z.read(e.filename)))
   for k,v in changes.items():
    if k not in z.namelist():out.writestr(k,v)
  with zipfile.ZipFile(p/(n+'.candidate.zip')) as b:assert all(z.read(k)==b.read(k) for k in z.namelist() if k not in changes)
 rows.append({'name':n,'baseRevision':c['RevisionId'],'baseSha':c['CodeSha256'],'candidateSha':base64.b64encode(hashlib.sha256((p/(n+'.candidate.zip')).read_bytes()).digest()).decode(),'changedEntries':list(changes),'role':c['Role']})
policy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'lambda:InvokeFunction','Resource':'arn:aws:lambda:us-east-1:699561669180:function:wizzcentral-notifications-staging-pushSendOrderUpdate'}]}
(p/'policy.json').write_text(json.dumps(policy));(p/'manifest.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows,indent=2))
