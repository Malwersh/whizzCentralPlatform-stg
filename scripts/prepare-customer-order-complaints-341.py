from pathlib import Path
import copy,hashlib,json,zipfile
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/customer-complaints-341');records=[]
for tag in ['financial','staff','order','deletion','deletionworker']:
 configPath=P/('staging-driver-financial-accept-config.json'if tag=='financial'else tag+'-config.json');config=json.loads(configPath.read_text());base=P/('staging-driver-financial-accept.zip'if tag=='financial'else tag+'-base.zip');src=zipfile.ZipFile(base);changes={}
 if tag=='financial':
  s=src.read('index.js');changes['index.js']=s+b'\n// Post-delivery support cases: preserve the existing financial/payout executor.\nconst previousComplaint341=module.exports.financialAcceptanceHandler;\nmodule.exports.financialAcceptanceHandler=(event,...args)=>["customer_order_complaint","staff_order_complaint"].includes(event?.action)?require("./customer-order-complaint-runtime-341.js").customerOrderComplaintHandler(event):previousComplaint341(event,...args);\n';changes['customer-order-complaint-runtime-341.js']=(P/'customer-order-complaint-runtime-341.js').read_bytes()
 elif tag=='staff':
  changes={n:(R/'backend/staff-service'/n).read_bytes()for n in ['order-exception-cases.js','order-exception-case-client.js']}
  for n in changes:
   assert b'CUSTOMER_POST_DELIVERY'not in src.read(n)
  changes['customer-benefit-compensation-runtime.js']=(P/'customer-benefit-compensation-runtime-341.js').read_bytes()
 elif tag=='order':
  s=src.read('dist/index.js').decode();anchor='      if (input.workflow === "CUSTOMER_CASH_REVIEW") {';assert s.count(anchor)==1
  s=s.replace(anchor,'''      if (input.workflow === "CUSTOMER_POST_DELIVERY") {
        try {return buildSuccessResponse(await require('../customer-order-complaint-client').invokeCustomerOrderComplaint(event,input),200);}
        catch(error){return buildErrorResponse(error.status||503,error.status?error.message:'COMPLAINT_UNAVAILABLE','تعذر تأكيد متابعة الشكوى؛ حدّث الحالة قبل إعادة المحاولة');}
      }
'''+anchor,1);changes['dist/index.js']=s.encode();changes['customer-order-complaint-client.js']=(R/'backend/order-service/customer-order-complaint-client.js').read_bytes()
 else:
  s=src.read('cod-retention.js').decode();anchor=' return [...events,...dispatch,...reviews];'if tag=='deletion'else' return [...events,...dispatch,...cash,...reviews];';assert s.count(anchor)==1
  s=s.replace(anchor," const complaints=(await scan(db,'staging-Holds',maxPages)).filter(r=>r.kind==='CUSTOMER_POST_DELIVERY_CASE'&&owned(r)).map(r=>({orderId:r.orderId,operationId:r.caseId,status:r.state==='CLOSED'?'POST_DELIVERY_CASE_RETENTION_REVIEW':'POST_DELIVERY_COMPLAINT_PENDING'}));\n"+anchor.replace('...reviews]','...reviews,...complaints]'));changes['cod-retention.js']=s.encode()
 candidate=P/(tag+'-candidate.zip')
 with zipfile.ZipFile(candidate,'w')as dst:
  for item in src.infolist():dst.writestr(copy.copy(item),changes.get(item.filename,src.read(item.filename)))
  for n,b in changes.items():
   if n not in src.namelist():dst.writestr(n,b)
 with zipfile.ZipFile(candidate)as dst:
  assert all(dst.read(n)==src.read(n)for n in src.namelist()if n not in changes)
 records.append({'tag':tag,'name':config['FunctionName'],'beforeCodeSha256':config['CodeSha256'],'revisionId':config['RevisionId'],'candidateSHA256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'changedFiles':list(changes),'otherEntriesPreserved':True,'configurationPreserved':True})
(P/'package-review.json').write_text(json.dumps({'part':341,'functions':records,'financialExecutorsPreserved':True,'supportServiceUnchanged':True},indent=2)+'\n');print('PASS reviewed packages for '+', '.join(r['tag']for r in records))
