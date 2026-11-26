from pathlib import Path
import json,zipfile,copy,re,urllib.request,hashlib
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-cash-payout-v1');meta=json.loads((P/'hosting.private.json').read_text());latest=meta['latest'];assert latest['status']=='SUCCEED'
base=P/'hosting-base.zip'
if not base.exists():
 receipt=json.loads((R/'docs/region-management-publication-312.json').read_text());assert str(receipt['hostingJob'])==str(latest['jobId'])
 known=R/'backend/.tmp/regions-312/hosting-candidate.zip';assert known.exists()
 # The saved published artifact plus live checks bind the fallback to the current job.
 with zipfile.ZipFile(known)as z:
  for name in ['drivers.js','pages/drivers.html','pages/finance.html','finance-print-company.js','merchant-cashboxes.js']:
   req=urllib.request.Request('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name+'?driverpayoutbase=v1',headers={'Cache-Control':'no-cache'})
   assert urllib.request.urlopen(req,timeout=30).read()==z.read(name),'HOSTED_BASE_DRIFT '+name
 base.write_bytes(known.read_bytes())
with zipfile.ZipFile(base)as z:
 changes={}
 source=z.read('drivers.js').decode();needle='<div class="actions">';assert source.count(needle)==1
 button="${window.RBAC.staff?.permissions.includes('finance.read')?`<button class=\"btn-action\" data-driver-id=\"${safeId}\" data-action=\"cash-payouts\" title=\"صرف رصيد السائق\">صرف الرصيد</button>`:''}"
 source=source.replace(needle,needle+button,1);needle="        if(action === 'vehicles')";assert source.count(needle)==1
 source=source.replace(needle,"        if(action === 'cash-payouts') { window.openDriverCashPayouts(id); return; }\n"+needle)
 changes['drivers.js']=source.encode()
 source=z.read('pages/drivers.html').decode();source,n=re.subn(r'(<script\b[^>]*src=["\'])([^"\']*\bdrivers\.js)(?:\?[^"\']*)?(["\'][^>]*>)',lambda m:'<script src="../finance-print-company.js?v=driver-cash-payout-v1"></script>\n<script src="../driver-cash-payouts.js?v=1"></script>\n'+m[1]+m[2]+'?v=driver-cash-payout-v1'+m[3],source);assert n==1;changes['pages/drivers.html']=source.encode()
 source=z.read('finance-print-company.js').decode();assert 'function signatures(doc,operator){'in source
 source=source.replace('function signatures(doc,operator){',"function signatures(doc,operator,recipientLabel='اسم وصفة مخوّل المتجر المستلم'){").replace("'اسم وصفة مخوّل المتجر المستلم: ________________________________________'","recipientLabel+': ________________________________________'");changes['finance-print-company.js']=source.encode()
 source=z.read('merchant-cashboxes.js').decode();assert "MERCHANT_PAYOUT_DELIVERY:'تسليم نقدي لمطعم',"in source
 source=source.replace("MERCHANT_PAYOUT_DELIVERY:'تسليم نقدي لمطعم',","DRIVER_PAYOUT_DELIVERY:'تسليم نقدي لسائق',DRIVER_PAYOUT_RETURN:'إعادة نقد صرف سائق لم يتم',MERCHANT_PAYOUT_DELIVERY:'تسليم نقدي لمطعم',").replace("'سند المطعم: '+r.voucherNumber","(r.beneficiaryType==='DRIVER'?'سند السائق: ':'سند المطعم: ')+r.voucherNumber");changes['merchant-cashboxes.js']=source.encode()
 source=z.read('pages/finance.html').decode();start=source.index('<main');i=source.index('<section',start);source=source[:i]+'<section id="driver-cash-payout-queue" class="card" aria-label="طلبات صرف السائقين"></section>'+source[i:]
 for name in ['merchant-cashboxes.js','finance-print-company.js']:
  source=re.sub(re.escape(name)+r'(?:\?[^"\']*)?',name+'?v=driver-cash-payout-v1',source)
 source=source.replace('</body>','<script src="../driver-cash-payouts.js?v=1"></script></body>');changes['pages/finance.html']=source.encode()
 changes['driver-cash-payouts.js']=(R/'frontend/driver-cash-payouts.js').read_bytes()
 with zipfile.ZipFile(P/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for ent in z.infolist():out.writestr(copy.copy(ent),changes.get(ent.filename,z.read(ent.filename)))
  for name,body in changes.items():
   if name not in z.namelist():out.writestr(name,body)
 with zipfile.ZipFile(P/'hosting-candidate.zip')as out:assert all(z.read(n)==out.read(n)for n in z.namelist()if n not in changes)
(P/'hosting-review.json').write_text(json.dumps({'previousHostingJob':latest['jobId'],'changedFiles':list(changes),'otherEntriesPreserved':True,'candidateSha256':hashlib.sha256((P/'hosting-candidate.zip').read_bytes()).hexdigest()},indent=2))
print('Prepared six-file hosting overlay; other live entries byte-identical')
