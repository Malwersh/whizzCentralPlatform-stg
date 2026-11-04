from pathlib import Path
import zipfile,json,urllib.request,subprocess
B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];c=json.loads(subprocess.check_output(B+['lambda','get-function','--function-name','staging-wizz-staff-service']));Path('/tmp/promo412c-function.json').write_text(json.dumps(c));raw=urllib.request.urlopen(c['Code']['Location']).read();Path('/tmp/promo412c-before.zip').write_bytes(raw);z=zipfile.ZipFile('/tmp/promo412c-before.zip');data={n:z.read(n) for n in z.namelist()};n='_discount_review/central-staff/index.js';s=data[n].decode();a="return {campaigns:[]};";assert s.count(a)==1;s=s.replace(a,'return {campaigns:[],settings:headerConfig};');a='return standalone ? { campaigns: slides } :';assert s.count(a)==1;s=s.replace(a,'return standalone ? { campaigns: slides, ...(headerOffers?{settings:headerConfig}:{}) } :');data[n]=s.encode();Path('/tmp/promo412c-check.cjs').write_text(s);subprocess.check_call(['node','--check','/tmp/promo412c-check.cjs']);
with zipfile.ZipFile('/tmp/promo412c-candidate.zip','w',zipfile.ZIP_DEFLATED) as o:
 for n,v in data.items():o.writestr(n,v)
print('Prepared fresh control settings in header feed')
