from pathlib import Path
import json,subprocess,zipfile,copy,re,urllib.request,time
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/case-ORD1792911323338');base=Path('/private/tmp/driver-quality-review-289/web-candidate.zip')
def aws(*a):return json.loads(subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']))
latest=aws('amplify','list-jobs','--app-id','d2vmebm1e1n95m','--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']=='207'and latest['status']=='SUCCEED','Hosted version drift; recapture before edit'
z=zipfile.ZipFile(base);s=z.read('case-workflow.js').decode();needle="const fin=item.exceptionFinancials||{},post=fin.entitlementsPosted,fd=fin.entitlementDecision,gd=fin.guaranteeDecision,g=item.guaranteeBalance||{},financial=item.financialModel==='FULL_CASH',complete=!!item.taskCompletion||item.orderStatus==='returned'&&item.returnReceipt?.allItemsReceived===true;";assert s.count(needle)==1
s=s.replace(needle,"const cancellation=['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(item.caseKey),cancelledBeforePickup=cancellation&&item.commercialCancellationState==='CANCELLED'&&['cancelled','canceled'].includes(item.orderStatus);\n"+needle.replace('complete=!!item.taskCompletion','complete=cancelledBeforePickup||!!item.taskCompletion'),1)
needle="complete?'انتهت عهدة السائق':label(item.orderStatus)";assert s.count(needle)==1;s=s.replace(needle,"cancelledBeforePickup?'أُلغيت المهمة قبل الاستلام':"+needle,1)
source=(R/'frontend/case-workflow.js').read_text();a=source.index("let cancellationClose=$('cancellation-close-link');");b=source.index("$('closure-state').textContent",a);insert=source[a:b];needle="const canClose=complete&&fareDone&&resolved&&compDone&&!closed&&!companyPending&&!appealPending;";assert s.count(needle)==1;s=s.replace(needle,needle+'\n'+insert,1)
s=s.replace("$('close-exception-financials').hidden=!canClose;","$('close-exception-financials').hidden=!canClose||cancellation;",1).replace("$('reason-close').closest('label').hidden=!canClose;","$('reason-close').closest('label').hidden=!canClose||cancellation;",1)
changes={'case-workflow.js':s.encode()};s=z.read('pages/order-exceptions.html').decode();s,n=re.subn(r'(case-workflow\.js\?v=)[^\"]+',r'\g<1>cancel-before-pickup-20261025',s);assert n==1;changes['pages/order-exceptions.html']=s.encode()
candidate=P/'web-candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
new=zipfile.ZipFile(candidate);assert all(new.read(n)==z.read(n)for n in z.namelist()if n not in changes);(P/'case-workflow-candidate.js').write_bytes(changes['case-workflow.js'])
subprocess.run(['node','--check',str(P/'case-workflow-candidate.js')],check=True)
# Validate the captured candidate, not just the working copy, before publication.
import os
env={**os.environ,'NODE_PATH':'/private/tmp/wizz-browser-check/node_modules','CASE_WORKFLOW_FILE':str(P/'case-workflow-candidate.js')};subprocess.run(['node',str(R/'scripts/test-cancellation-case-progress-20261025.cjs')],cwd=R,env=env,check=True)
job=aws('amplify','create-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging');req=urllib.request.Request(job['zipUploadUrl'],data=candidate.read_bytes(),method='PUT',headers={'Content-Type':'application/zip'})
with urllib.request.urlopen(req,timeout=45)as response:assert response.status in[200,201]
aws('amplify','start-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',job['jobId'])
for _ in range(60):
 state=aws('amplify','get-job','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',job['jobId'])['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in['FAILED','CANCELLED'];time.sleep(2)
assert state=='SUCCEED'
for n,body in changes.items():
 for attempt in range(10):
  with urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?cancel-case='+str(attempt),timeout=20)as response:matched=response.read()==body
  if matched:break
  time.sleep(2)
 assert matched,n
receipt={'status':'PUBLISHED_BYTE_VERIFIED','hostingJob':job['jobId'],'previousHostingJob':'207','changedFiles':list(changes),'allOtherHostedEntriesIdentical':True,'businessMutations':False,'caseOrder':'ORD1792911323338','fix':'Cancelled pre-pickup task is operationally complete and cancellation closure routes to compensation page, not the return-only closure action.'};(R/'docs/cancellation-case-progress-20261025.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
