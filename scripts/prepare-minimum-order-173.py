"""Prepare minimum-order-only overlays against captured live staging packages."""
import pathlib,zipfile,io,copy,json,subprocess,hashlib,base64
p=pathlib.Path('/private/tmp/minimum-173');m=pathlib.Path('../whizzMerchants-stg/backend/functions/shared/order-reception.js')
receipts=[]
for d in sorted(x for x in p.iterdir() if x.is_dir()):
 z=zipfile.ZipFile(d/'original.zip');replacements={}
 if d.name.startswith('order-receiver-'):replacements['shared/order-reception.js']=m.read_bytes()
 elif d.name=='WizzUser-DeliveryQuotes-staging':replacements['storefront-runtime.js']=(p/'storefront-runtime.js').read_bytes()
 elif d.name=='WizzUser-CreateOrder-staging':
  n='functions/create-order/commercial-runtime.js';s=z.read(n).decode();needle='        const operations = [\n          ...goods.conditions,';assert s.count(needle)==1
  check='''        const branchMinimum173=branch.minimum_order;
        if(branchMinimum173!=null&&branchMinimum173!==0){
          if(!Number.isSafeInteger(branchMinimum173)||branchMinimum173<0||branchMinimum173>1000000000)throw Object.assign(Error('INVALID_MINIMUM_ORDER'),{code:'INVALID_MINIMUM_ORDER',statusCode:409});
          if(goods.goodsGross.minorAmount<branchMinimum173*1000)throw Object.assign(Error('MINIMUM_ORDER_NOT_MET'),{code:'MINIMUM_ORDER_NOT_MET',statusCode:409,minimumOrderAmountIqd:branchMinimum173});
        }
'''
  s=s.replace(needle,check+needle);needle='          "deletionRequestId"\n        ];';assert s.count(needle)==1;s=s.replace(needle,'          "deletionRequestId",\n          "minimum_order"\n        ];');replacements[n]=s.encode()
  needle='["FINANCE_ROLLOUT_OUT_OF_SCOPE", "FINANCE_ROLLOUT_ADMISSION_CLOSED"';assert s.count(needle)==1;s=s.replace(needle,'["MINIMUM_ORDER_NOT_MET", "INVALID_MINIMUM_ORDER", "FINANCE_ROLLOUT_OUT_OF_SCOPE", "FINANCE_ROLLOUT_ADMISSION_CLOSED"');replacements[n]=s.encode()
 else:raise Exception(d.name)
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w')as dest:
  for item in z.infolist():dest.writestr(copy.copy(item),replacements.get(item.filename,z.read(item.filename)))
 b=out.getvalue();check=zipfile.ZipFile(io.BytesIO(b));assert all(z.read(n)==check.read(n)for n in z.namelist()if n not in replacements)
 for i,(name,data)in enumerate(replacements.items()):
  f=d/('check'+str(i)+'.js');f.write_bytes(data);subprocess.run(['node','--check',str(f)],check=True)
 (d/'candidate.zip').write_bytes(b);receipts.append({'function':d.name,'changedEntries':list(replacements),'otherEntriesIdentical':True,'candidateCodeSha256':base64.b64encode(hashlib.sha256(b).digest()).decode()})
pathlib.Path('docs/minimum-order-candidate-173.json').write_text(json.dumps(receipts,indent=2)+'\n');print(json.dumps(receipts))
