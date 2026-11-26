from pathlib import Path
import subprocess,json,urllib.request,zipfile,copy,base64,hashlib,os
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=Path('/private/tmp/driver-quality-self-service-290');P.mkdir(exist_ok=True)
def aws(*a):
 b=subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']);return json.loads(b)if b.strip()else{}
manifest=[]
for label,name in [('financial','staging-driver-financial-accept'),('driver','DriversApi-staging'),('deletion-request','staging-account-deletion-requests'),('deletion-worker','staging-account-deletion-worker')]:
 f=aws('lambda','get-function','--function-name',name);cfg=f['Configuration'];private=P/(label+'-config.private.json');private.write_text(json.dumps(cfg));os.chmod(private,0o600)
 if (P/(label+'-base.zip')).exists() and base64.b64encode(hashlib.sha256((P/(label+'-base.zip')).read_bytes()).digest()).decode()==cfg['CodeSha256']:body=(P/(label+'-base.zip')).read_bytes()
 else:
  with urllib.request.urlopen(f['Code']['Location'],timeout=45)as response:body=response.read()
 assert base64.b64encode(hashlib.sha256(body).digest()).decode()==cfg['CodeSha256'];(P/(label+'-base.zip')).write_bytes(body);z=zipfile.ZipFile(P/(label+'-base.zip'));changes={}
 if label=='financial':
  changes['driver-quality-review-runtime-289.js']=(R/'backend/shared/driver-quality-review-runtime-289.js').read_bytes();changes['driver-quality-driver-runtime-290.js']=(R/'backend/shared/driver-quality-driver-runtime-290.js').read_bytes()
  s=z.read('index.js').decode();assert 'previousDriverQualityAppeal290'not in s;s+='\n// Driver own quality appeal290: preserves all existing actions.\nconst previousDriverQualityAppeal290=module.exports.financialAcceptanceHandler;\nmodule.exports={...module.exports,financialAcceptanceHandler:async(event,...args)=>event?.action===\'driver_quality_case\'?require(\'./driver-quality-driver-runtime-290.js\').handler(event):previousDriverQualityAppeal290(event,...args)};\n';changes['index.js']=s.encode()
 elif label=='driver':
  entry=cfg['Handler'].rsplit('.',1)[0]+'.js';source=(D/'backend/lambda_driver_api_v2.js').read_text();a=source.index("    if ((path === '/driver/quality-incidents'");b=source.index("    if ((path === '/driver/performance'",a);s=z.read(entry).decode();needle="    if ((path === '/driver/performance'";assert s.count(needle)==1;s=s.replace(needle,source[a:b]+needle,1);changes[entry]=s.encode()
  s=z.read('financial-accept-client.js').decode();needle="['driver_cash_case','return_case_driver','read_offer'";assert s.count(needle)==1;s=s.replace(needle,"['driver_quality_case','driver_cash_case','return_case_driver','read_offer'",1);needle="if(process.env.FINANCIAL_DISPATCH_MODE!=='REQUIRED'||process.env.FINANCIAL_ACCEPT_FUNCTION_ARN!==TARGET)";assert s.count(needle)==1;s=s.replace(needle,"if((action!=='driver_quality_case'&&process.env.FINANCIAL_DISPATCH_MODE!=='REQUIRED')||process.env.FINANCIAL_ACCEPT_FUNCTION_ARN!==TARGET)",1);changes['financial-accept-client.js']=s.encode()
  for n in ['driver-quality-incidents-290.js','driver-quality-proof-290.js']:changes[n]=(D/'backend'/n).read_bytes()
 else:
  for n in ['cod-retention.js','driver-evidence.js','policy.js','quality-review-retention-290.js']:
   if label=='deletion-worker'and n=='driver-evidence.js':continue # Worker uses cod-retention cleanup guard, not request evidence.
   if n=='quality-review-retention-290.js':changes[n]=(R/'backend/account-deletion'/n).read_bytes();continue
   # Apply only this phase's additive changes to captured live source.
   s=z.read(n).decode();source=(R/'backend/account-deletion'/n).read_text()
   if n=='cod-retention.js':
    needle=" return [...events,...dispatch];"
    if needle in s:
     s=s.replace(needle," const reviews=require('./quality-review-retention-290').pendingQualityReviews(await scan(db,'staging-Holds',maxPages),driverIds);\n return [...events,...dispatch,...reviews];",1)
    else:
     needle=" return [...events,...dispatch,...cash];";assert s.count(needle)==1
     s=s.replace(needle," const reviews=require('./quality-review-retention-290').pendingQualityReviews(await scan(db,'staging-Holds',maxPages),driverIds);\n return [...events,...dispatch,...cash,...reviews];",1)
   elif n=='driver-evidence.js':
    needle='return {complete:true,profileIds:ids,';assert s.count(needle)==1;s=s.replace(needle,"return {complete:true,pendingReviews:cod.filter(r=>r.status.startsWith('QUALITY_')),profileIds:ids,",1);needle='...gateway,...priorAttempts,...cod,...payments';assert s.count(needle)==1;s=s.replace(needle,"...gateway,...priorAttempts,...cod.filter(r=>!r.status.startsWith('QUALITY_')),...payments",1)
   else:
    needle=" if(evidence.pendingPayments?.length)";assert s.count(needle)==1;s=s.replace(needle," if(evidence.pendingReviews?.length)issues.push({code:'QUALITY_CASE_REVIEW_REQUIRED',action:'REVIEW_NONFINANCIAL_CASE_AND_RETENTION_POLICY'});\n"+needle,1);needle='function decision(issues,settings){';assert s.count(needle)==1;s=s.replace(needle,needle+"\n if(issues.length&&issues.every(i=>i.code==='QUALITY_CASE_REVIEW_REQUIRED'))return 'PENDING_POLICY';",1)
   changes[n]=s.encode()
 candidate=P/(label+'-candidate.zip')
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for n,v in changes.items():
   if n not in z.namelist():out.writestr(n,v)
 checked=zipfile.ZipFile(candidate);assert all(z.read(n)==checked.read(n)for n in z.namelist()if n not in changes);runtime=P/(label+'-runtime');runtime.mkdir(exist_ok=True);checked.extractall(runtime)
 for n in changes:subprocess.run(['node','--check',str(runtime/n)],check=True)
 permissions=[]
 if label=='driver':permissions=[('dynamodb:Query','arn:aws:dynamodb:us-east-1:699561669180:table/staging-Holds')]

 for action,resource in permissions:
  probe=aws('iam','simulate-principal-policy','--policy-source-arn',cfg['Role'],'--action-names',action,'--resource-arns',resource);print(label,'permission',action,resource,[x['EvalDecision']for x in probe['EvaluationResults']],flush=True)
 manifest.append({'label':label,'function':name,'before':cfg['CodeSha256'],'revision':cfg['RevisionId'],'candidate':base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode(),'changedFiles':list(changes),'allOtherEntriesIdentical':True,'existingPermissionsVerified':permissions});print(label,'PREPARED',flush=True)
(R/'docs/driver-quality-self-service-packages-290.json').write_text(json.dumps({'status':'PREPARED_NOT_PUBLISHED','functions':manifest,'newIam':'DRIVER_QUERY_HOLDS_ONLY_REQUIRED','newTables':False,'apiGatewayChanges':False,'financialCalculationsChanged':False},indent=2)+'\n');print('Four packages prepared; driver Query Holds permission required; no new tables or API routes.',flush=True)
