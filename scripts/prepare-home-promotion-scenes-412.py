from pathlib import Path
import zipfile,json,urllib.request,subprocess
B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];c=json.loads(subprocess.check_output(B+['lambda','get-function','--function-name','staging-wizz-staff-service']));Path('/tmp/promo412-function.json').write_text(json.dumps(c));raw=urllib.request.urlopen(c['Code']['Location']).read();Path('/tmp/promo412-before.zip').write_bytes(raw);z=zipfile.ZipFile('/tmp/promo412-before.zip');data={n:z.read(n) for n in z.namelist()}
n='_discount_review/central-staff/index.js';s=data[n].decode()
a='merchants.push({ id: businessId, name: m7.businessName || m7.businessNameArabic || m7.name || businessId });';b="merchants.push({ id: businessId, name: m7.businessName || m7.businessNameArabic || m7.name || businessId, ...(headerOffers?{logoUrl:m7.businessPhotoUrl||m7.business_photo_url||m7.logoUrl||''}:{}) });";assert s.count(a)==1;s=s.replace(a,b)
a='slides.push({ id: s7.id, title: s7.title,';b="const scene=headerOffers&&s7.action.type==='discount'&&merchants[0]?await require(process.env.LAMBDA_TASK_ROOT+'/promotion-scenes.js').enrich(ctx,merchants[0],row,headerConfig):null;\n      slides.push({...(scene?{scene}:{}), id: s7.id, title: s7.title,";assert s.count(a)==1;s=s.replace(a,b);data[n]=s.encode()
for n in ['home-promotion-settings.js','promotion-scenes.js']:data[n]=Path('backend/staff-service',n).read_bytes()
for i,n in enumerate(['_discount_review/central-staff/index.js','home-promotion-settings.js','promotion-scenes.js']):
 p=Path('/tmp/promo412-check'+str(i)+'.cjs');p.write_bytes(data[n]);subprocess.check_call(['node','--check',str(p)])
with zipfile.ZipFile('/tmp/promo412-candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for n,v in data.items():out.writestr(n,v)
print('Prepared scene metadata overlay; all other files retained')
