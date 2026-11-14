"""Close legacy minimum bypass using the canonical parser/catalog reader and the existing branch transaction guard."""
import pathlib,zipfile,io,copy,json,subprocess,hashlib,base64
p=pathlib.Path('/private/tmp/minimum-173/WizzUser-CreateOrder-staging');z=zipfile.ZipFile(p/'candidate.zip');n='functions/create-order/index.js';s=z.read(n).decode()
needle='        const serviceFee = Math.round((body.serviceFee || 0) * 1000);';assert s.count(needle)==1;s=s.replace(needle,"        const minimumPolicy=require('../shared/branch-minimum-order');\n        const minimumBranch=await minimumPolicy.read(dynamoDb,body.storeId);\n"+needle)
needle='if(body.discountId||body.promoCode||body.platformDiscountId){';assert s.count(needle)==1;s=s.replace(needle,'if(body.discountId||body.promoCode||body.platformDiscountId||minimumPolicy.minimumOrderIqd(minimumBranch)!==null){')
needle='            discountItems=catalogItems(catalog);';assert s.count(needle)==1;s=s.replace(needle,'            minimumPolicy.assertMinimumOrder(minimumBranch,catalog.goodsGross.minorAmount);\n'+needle)
needle='...((q)=>{if(receptionCondition)';assert s.count(needle)==1;s=s.replace(needle,'...((q)=>{minimumPolicy.guard(q.ConditionCheck,minimumBranch);if(receptionCondition)')
needle='                errorName: error.name,\n                success: false';assert s.count(needle)==1;s=s.replace(needle,"                errorName: error.name,\n                ...(['MINIMUM_ORDER_NOT_MET','INVALID_MINIMUM_ORDER'].includes(error.message)?{code:error.message}:{}),\n                success: false")
u=pathlib.Path('../wizzuser-stg/backend/src/functions');replacements={n:s.encode(),'functions/shared/branch-minimum-order.js':(u/'shared/branch-minimum-order.js').read_bytes(),'functions/create-order/quote-runtime/branchMinimumOrder.js':(u/'create-order/quote-runtime/branchMinimumOrder.js').read_bytes()}
out=io.BytesIO()
with zipfile.ZipFile(out,'w')as dest:
 for item in z.infolist():dest.writestr(copy.copy(item),replacements.get(item.filename,z.read(item.filename)))
 for name,data in replacements.items():
  if name not in z.namelist():dest.writestr(name,data)
b=out.getvalue();check=zipfile.ZipFile(io.BytesIO(b));assert all(z.read(n)==check.read(n)for n in z.namelist()if n not in replacements)
(p/'legacy-candidate.zip').write_bytes(b)
for i,(n,data)in enumerate(replacements.items()):f=p/('legacy-check'+str(i)+'.js');f.write_bytes(data);subprocess.run(['node','--check',str(f)],check=True)
print(json.dumps({'changedEntries':list(replacements),'otherEntriesIdentical':True,'codeSha256':base64.b64encode(hashlib.sha256(b).digest()).decode()}))
