from pathlib import Path
import zipfile,subprocess,json,urllib.request
B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];c=json.loads(subprocess.check_output(B+['lambda','get-function','--function-name','staging-wizz-staff-service']));Path('/tmp/header411b-function.json').write_text(json.dumps(c));raw=urllib.request.urlopen(c['Code']['Location']).read();Path('/tmp/header411b-before.zip').write_bytes(raw);z=zipfile.ZipFile('/tmp/header411b-before.zip');data={n:z.read(n) for n in z.namelist()}
def replace(s,a,b):
 assert s.count(a)==1,(a[:90],s.count(a));return s.replace(a,b)
n='home-taxonomy-378.js';s=data[n].decode()
s=replace(s,'["/staff/home-layout/draft", "/staff/home-layout/publish", "/staff/home-layout/rollback"]','["/staff/home-layout/draft", "/staff/home-layout/publish", "/staff/home-layout/rollback", "/staff/home-layout/promotion-header/publish"]')
s=replace(s,'const publishing = path !== "/staff/home-layout/draft";','const publishing = path !== "/staff/home-layout/draft",headerOnly=path==="/staff/home-layout/promotion-header/publish";')
s=replace(s,'} else if (path.endsWith("/rollback")) {','''} else if(headerOnly){promo=promotionHeader.validate(current.draftPromotionHeader??current.published?.promotionHeader);sections=validate(current.published?.sections??[]);filters=homeFilters.validate(current.published?.filters);nav=navigation.validate(current.published?.navigation);welcome=validateCopy(current.published?.welcome);
      } else if (path.endsWith("/rollback")) {''')
s=replace(s,'next.published = { revision: next.version, sections, welcome, navigation: nav, filters, promotionHeader:promo, publishedAt: now };','next.published = headerOnly?{...(current.published??{sections,welcome,navigation:nav,filters}),revision:next.version,promotionHeader:promo,publishedAt:now}:{ revision: next.version, sections, welcome, navigation: nav, filters, promotionHeader:promo, publishedAt: now };');data[n]=s.encode()
n='_discount_review/central-staff/index.js';s=data[n].decode();s=replace(s,'m7.isActive !== false && !m7.platformSuspended) merchants.push','m7.isActive !== false && !m7.platformSuspended && (!headerOffers||(m7.regionId&&ancestors.includes(m7.regionId)))) merchants.push');data[n]=s.encode()
for i,n in enumerate(['home-taxonomy-378.js','_discount_review/central-staff/index.js']):
 p=Path('/tmp/header411b-check'+str(i)+'.cjs');p.write_bytes(data[n]);subprocess.check_call(['node','--check',str(p)])
with zipfile.ZipFile('/tmp/header411b-candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for n,v in data.items():out.writestr(n,v)
print('Prepared isolated header publication; no other modules changed')
