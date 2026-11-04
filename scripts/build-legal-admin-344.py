"""Patch only the legal-settings route into the captured deployed staff bundle. No AWS writes."""
import pathlib,zipfile,hashlib,base64,json,copy,sys
root=pathlib.Path(__file__).resolve().parents[1];folder=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/private/tmp/customer-legal-344')
base=folder/'staff-base.zip';target=folder/'staff-legal-344.zip';entry='_discount_review/central-staff/index.js'
with zipfile.ZipFile(base) as source:
 raw=source.read(entry).decode();anchor='    if (path.startsWith("/staff/settings/")) return response';assert raw.count(anchor)==1
 assert 'customer-legal-documents-344' not in raw
 line="    if(path==='/staff/settings/legal-documents'||path.startsWith('/staff/settings/legal-documents/'))return response(200,await require('../../customer-legal-documents-344').route({db,table,guard,audit,enrolled,recent,claims,allowed},actor,method,path,input));\n"
 patched=raw.replace(anchor,line+anchor,1)
 assert patched.replace(line,'',1)==raw
 replacements={entry:patched.encode(),'customer-legal-documents-344.js':(root/'backend/staff-service/customer-legal-documents-344.js').read_bytes().replace(b"require('../shared/customer-legal-contract-344')",b"require('./customer-legal-contract-344')")}
 for n in ['customer-legal-contract-344.js','customer-legal-defaults-344.json','driver-legal-defaults-344.json','merchant-legal-defaults-344.json']:replacements[n]=(root/'backend/shared'/n).read_bytes()
 if 'write-workflow.js' not in source.namelist():replacements['write-workflow.js']=(root/'backend/staff-service/write-workflow.js').read_bytes()
 assert len(source.namelist())==len(set(source.namelist()))
 with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as out:
  for item in source.infolist():out.writestr(copy.copy(item),replacements.get(item.filename,source.read(item.filename)))
  for n,v in replacements.items():
   if n not in source.namelist():out.writestr(n,v)
 with zipfile.ZipFile(target) as out:
  for n in source.namelist():
   if n not in replacements:assert source.read(n)==out.read(n),n
manifest={'part':344,'scope':'STAFF_LEGAL_CMS_ONLY','function':'staging-wizz-staff-service','baseCodeSha256':base64.b64encode(hashlib.sha256(base.read_bytes()).digest()).decode(),'candidateCodeSha256':base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode(),'changedEntries':list(replacements),'unrelatedEntriesIdentical':True,'rootFinanceConfigurationWrapperPreserved':True,'iamChanges':False,'configurationChanges':False,'businessDataWrites':0,'status':'READY_NOT_PUBLISHED'}
(folder/'staff-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
