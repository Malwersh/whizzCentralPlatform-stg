"""Publish only case/voucher linkage; never invoke a business mutation."""
import boto3,pathlib,json,zipfile,copy,urllib.request,time,re
R=pathlib.Path(__file__).resolve().parents[1];P=R/'backend/.tmp/customer-compensation-252';s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};name='staging-wizz-staff-service';base=json.loads((P/'base-sha.json').read_text());job=json.loads((P/'base-job.json').read_text());prior=json.loads((P/'backend-publication.json').read_text())if (P/'backend-publication.json').exists()else None;assert l.get_function_configuration(FunctionName=name)['CodeSha256']==(prior['codeSha256']if prior else base['sha']);assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId']
with zipfile.ZipFile(P/'staff.base.zip')as old:
 index='_discount_review/central-staff/index.js';s0=old.read(index).decode();marker="    if(path==='/staff/cancellation-compensation')";assert s0.count(marker)==1
 s1=s0.replace(marker,"    if(path==='/staff/customer-benefit-compensation')return response(200,await require(process.env.LAMBDA_TASK_ROOT+'/customer-benefit-compensation-runtime.js').route({db,guard,audit,enrolled,recent,claims},actor,method,method==='GET'?event.queryStringParameters||{}:input));\n"+marker)
 needle='const grant = { ...key2, version: (before?.version || 0) + 1, grantedUses: input.uses';assert s1.count(needle)==1;s1=s1.replace(needle,'const grant = { ...key2, ...(before?.compensationReference ? {compensationReference:before.compensationReference} : {}), version: (before?.version || 0) + 1, grantedUses: input.uses')
 changes={index:s1.encode(),'customer-benefit-compensation-runtime.js':(P/'customer-benefit-compensation-runtime.js').read_bytes()}
 assert 'customer-benefit-compensation-runtime.js'not in old.namelist()
 with zipfile.ZipFile(P/'staff.candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
  out.writestr('customer-benefit-compensation-runtime.js',changes['customer-benefit-compensation-runtime.js'])
 with zipfile.ZipFile(P/'staff.candidate.zip')as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes)
if prior:
 report=prior
else:
 backend=l.update_function_code(FunctionName=name,ZipFile=(P/'staff.candidate.zip').read_bytes(),RevisionId=l.get_function_configuration(FunctionName=name)['RevisionId']);l.get_waiter('function_updated_v2').wait(FunctionName=name)
 assert l.get_function_configuration(FunctionName=name)['CodeSha256']==backend['CodeSha256'];report={'backendFunction':name,'baseCodeSha256':base['sha'],'codeSha256':backend['CodeSha256'],'backendChangedFiles':list(changes),'businessActionsExecuted':False,'iamChanges':False};(P/'backend-publication.json').write_text(json.dumps(report,indent=2))
with zipfile.ZipFile(P/'frontend.base.zip')as old:
 changes={n:(R/'frontend'/n).read_bytes()for n in ['customer-benefit-compensation.js','cancellation-compensation.js','cancellation-compensation-link.js','pages/cancellation-compensation.html','order-management.js']}
 changes['settlement-statements.js']=old.read('settlement-statements.js').decode().replace('تعويض مرتجع ·','تعويض معتمد ·').encode()
 t=old.read('order-exception-cases.js').decode();needle='renderExceptionFinance(item);';assert t.count(needle)==1;t=t.replace(needle,needle+'window.WizzCancellationCompensation?.render(item);window.WizzCustomerBenefitCompensation?.render(item);');assert "if(state.busy||document.visibilityState"in t;t=t.replace("if(state.busy||document.visibilityState","if(window.WizzCustomerBenefitCompensation?.hasDraft()||state.busy||document.visibilityState");changes['order-exception-cases.js']=t.encode()
 t=old.read('pages/order-exceptions.html').decode();needle='<script src="../order-exception-cases.js';assert t.count(needle)==1;t=t.replace(needle,'<script src="../cancellation-compensation-link.js?v=252"></script><script src="../customer-benefit-compensation.js?v=252"></script>'+needle);t=re.sub(r'(order-exception-cases\.js)(?:\?[^"\s<>]*)?(?=")',r'\1?v=252',t);changes['pages/order-exceptions.html']=t.encode()
 t=old.read('pages/orders.html').decode()
 if 'manage.dataset.manageOrderId' not in t:
  anchor='            actions.append(button);';assert t.count(anchor)==1;t=t.replace(anchor,anchor+"\n            const manage = text('button', 'إدارة الطلب', 'view-details-btn');\n            manage.type = 'button';\n            manage.dataset.manageOrderId = String(order.cleanOrderId || order.orderId || '');\n            actions.append(manage);");t=t.replace('</body>','<script src="../order-management.js?v=252"></script>\n</body>');changes['pages/orders.html']=t.encode()
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
  if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=252',timeout=30).read()==data:break
  time.sleep(2)
 else:raise AssertionError('HOSTED_BYTES_MISMATCH '+n)
report.update({'status':'PUBLISHED_VERIFIED','baseHostingJobId':job['jobId'],'hostingJobId':d['jobId'],'frontendChangedFiles':list(changes),'hostedBytesMatched':True});(P/'publication.json').write_text(json.dumps(report,indent=2));(R/'docs/customer-benefit-compensation-publication-252.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
