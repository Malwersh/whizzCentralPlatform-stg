"""Code-only staging publication; never execute a pickup/finance business action."""
import boto3,pathlib,json,zipfile,copy,urllib.request,time,re
R=pathlib.Path(__file__).resolve().parents[1];P=R/'backend/.tmp/pickup-workflow-253';s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');a=s.client('amplify');base=json.loads((P/'base.json').read_text());job=json.loads((P/'base-job.json').read_text());args={'appId':'d2vmebm1e1n95m','branchName':'staging'}
assert all(x['decision']=='allowed'for x in json.loads((P/'iam.json').read_text()));assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId'];report={'businessActionsExecuted':False,'iamChanges':False,'functions':{}}
for role in ['staff','driver']:
 b=base[role];current=l.get_function_configuration(FunctionName=b['function']);assert current['CodeSha256']==b['sha'],'Function changed; recapture required'
 with zipfile.ZipFile(P/(role+'.base.zip'))as old:
  if role=='staff':
   index='_discount_review/central-staff/index.js';t=old.read(index).decode();needle="    if(path==='/staff/customer-benefit-compensation')";assert t.count(needle)==1;t=t.replace(needle,"    if(path==='/staff/pickup-issues')return response(200,await require(process.env.LAMBDA_TASK_ROOT+'/pickup-issue-workflow-runtime.js').route({db,guard,audit,enrolled,recent,claims,allowed},actor,method,method==='GET'?event.queryStringParameters||{}:input));\n"+needle);changes={index:t.encode(),'pickup-issue-workflow-runtime.js':(P/'pickup-issue-workflow-runtime.js').read_bytes()}
  else:
   names=[n for n in old.namelist()if n.endswith('driver-pickup-issues.js')];assert len(names)==1;changes={names[0]:(R.parent/'whizzDrivers-stg/backend/driver-pickup-issues.js').read_bytes()};original=old.read(names[0]).decode();assert 'merchantHandover'not in original;assert original.replace('||order.pickedUpAt||order.pickupAt)', '||order.pickedUpAt||order.pickupAt||order.merchantHandover)').replace('AND (attribute_not_exists(pickupIssueReportIds)','AND (attribute_not_exists(merchantHandover) OR merchantHandover = :null) AND (attribute_not_exists(pickupIssueReportIds)')==changes[names[0]].decode()
  with zipfile.ZipFile(P/(role+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
   for n,data in changes.items():
    if n not in old.namelist():out.writestr(n,data)
  with zipfile.ZipFile(P/(role+'.candidate.zip'))as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes)
 updated=l.update_function_code(FunctionName=b['function'],ZipFile=(P/(role+'.candidate.zip')).read_bytes(),RevisionId=current['RevisionId']);l.get_waiter('function_updated_v2').wait(FunctionName=b['function']);assert l.get_function_configuration(FunctionName=b['function'])['CodeSha256']==updated['CodeSha256'];report['functions'][role]={'function':b['function'],'baseCodeSha256':b['sha'],'codeSha256':updated['CodeSha256'],'changedFiles':list(changes)};(P/'backend-publication.json').write_text(json.dumps(report,indent=2));print(role,'PUBLISHED_VERIFIED',flush=True)
with zipfile.ZipFile(P/'frontend.base.zip')as old:
 changes={n:(R/'frontend'/n).read_bytes()for n in ['pickup-issues.js','pages/pickup-issues.html']};t=old.read('order-management.js').decode();needle="'use strict';";assert t.count(needle)==1;local=(R/'frontend/order-management.js').read_text();line=next(x for x in local.splitlines()if x.startswith('const ordersTable='));t=t.replace(needle,needle+'\n'+line);needle=" content.append(button('تحديث الحالة'";assert t.count(needle)==1;t=t.replace(needle," const pickupLink=text('a','بلاغات الاستلام ومتابعتها');pickupLink.href='pickup-issues.html?'+new URLSearchParams({orderId:item.orderId});content.append(pickupLink);\n"+needle);changes['order-management.js']=t.encode()
 for n in old.namelist():
  if not n.endswith('.html'):continue
  t=old.read(n).decode();v=re.sub(r'(order-management\.js)(?:\?[^"\s<>]*)?(?=")',r'\1?v=253',t)
  if v!=t:changes[n]=v.encode()
 with zipfile.ZipFile(P/'frontend.candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
  for n,data in changes.items():
   if n not in old.namelist():out.writestr(n,data)
 with zipfile.ZipFile(P/'frontend.candidate.zip')as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId'];d=a.create_deployment(**args);urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=(P/'frontend.candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).read();a.start_deployment(**args,jobId=d['jobId'])
for _ in range(90):
 status=a.get_job(**args,jobId=d['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert status=='SUCCEED',status
for n,data in changes.items():
 for _ in range(20):
  if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=253',timeout=30).read()==data:break
  time.sleep(2)
 else:raise AssertionError(n)
report.update({'status':'PUBLISHED_VERIFIED','baseHostingJobId':job['jobId'],'hostingJobId':d['jobId'],'frontendChangedFiles':list(changes),'hostedBytesMatched':True});(P/'publication.json').write_text(json.dumps(report,indent=2));(R/'docs/pickup-workflow-publication-253.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
