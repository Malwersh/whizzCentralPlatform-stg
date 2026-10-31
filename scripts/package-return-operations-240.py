"""Prepare reviewable archives and least-privilege proposal; no AWS mutation."""
import pathlib,json,zipfile,copy,hashlib,base64
root=pathlib.Path(__file__).resolve().parents[1];p=root/'backend/.tmp/order-exceptions-work/return-240'
changesets={
'financial':{'index.js':p/'financial-candidate.js','order-exception-runtime-229.js':root/'backend/shared/order-exception-runtime-229.js'},
'staff':{'_discount_review/central-staff/index.js':p/'staff-candidate.js','order-exception-cases.js':root/'backend/staff-service/order-exception-cases.js','return-operations-settings.js':root/'backend/staff-service/return-operations-settings.js','return-operations-contract.js':root/'backend/staff-service/return-operations-contract.js'},
'merchant':{'order_returns.js':p/'merchant-candidate.js'},
'driver':{'lambda_driver_api_v2.js':p/'driver-candidate.js','financial-accept-client.js':root.parent/'whizzDrivers-stg/backend/financial-accept-client.js'},
'sla':{'index.js':p/'sla-candidate.js'}}
manifest=[]
for label,files in changesets.items():
 config=json.loads((p/(label+'-config.private.json')).read_text());raw=(p/(label+'-base.zip')).read_bytes()
 assert base64.b64encode(hashlib.sha256(raw).digest()).decode()==config['CodeSha256']
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for item in old.infolist():out.writestr(copy.copy(item),files[item.filename].read_bytes()if item.filename in files else old.read(item.filename))
   for name,file in files.items():
    if name not in old.namelist():out.writestr(name,file.read_bytes())
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in files)
 manifest.append({'name':config['FunctionName'],'label':label,'baseCodeSha256':config['CodeSha256'],'candidateSha256':hashlib.sha256((p/(label+'-candidate.zip')).read_bytes()).hexdigest(),'changedFiles':list(files),'unrelatedEntriesIdentical':True})
(p/'package-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
policy={'Version':'2012-10-17','Statement':[
{'Sid':'ReadReturnOperationsPolicy','Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff','Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#RETURN_OPERATIONS']}}},
{'Sid':'OwnerReturnAcceptanceMetadataOnly','Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:ConditionCheckItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-MerchantPlatform','Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['RETURN_ACCEPTANCE#*']}}}]}
(root/'docs/return-operations-240-proposed-iam-policy.json').write_text(json.dumps(policy,indent=2)+'\n')
print('PASS five archives preserve unrelated entries; scoped metadata IAM proposal prepared. No AWS changes.')
