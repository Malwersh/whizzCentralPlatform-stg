"""Publish only new Arabic permission labels and the matching cache reference."""
import sys,pathlib,json,zipfile,copy,urllib.request,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/registry-259');a=session().client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';job=a.get_job(**args,jobId=base['jobId'])['job'];url=next(x['artifactsUrl']for x in job['steps']if x.get('artifactsUrl'));(p/'editor-hosting-base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={}
with zipfile.ZipFile(p/'editor-hosting-base.zip')as old:
 key='merchant-staff-policy.js';text=old.read(key).decode();new=text.replace("'payout.request':'طلب صرف',", "'payout.request':'طلب صرف','payout.receive':'تأكيد استلام المستحقات',").replace("'حزمة تشغيل كاملة: القبول والرفض وتحديث الحالات. راجع السبب ثم احفظ.'", "'حزمة عمل النوع جاهزة. راجع وصف الصلاحيات والسبب ثم احفظ؛ تعيين الموظف يتطلب منحًا صريحًا من المالك.'");assert text!=new;assert new==(r/'frontend'/key).read_text();changes[key]=new.encode()
 key='pages/merchants.html';text=old.read(key).decode();assert text.count('merchant-staff-policy.js?v=20261015')==1;changes[key]=text.replace('merchant-staff-policy.js?v=20261015','merchant-staff-policy.js?v=259').encode()
 with zipfile.ZipFile(p/'editor-hosting-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
 with zipfile.ZipFile(p/'editor-hosting-candidate.zip')as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'];up=a.create_deployment(**args);urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=(p/'editor-hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=up['jobId']);print('Editor hosting '+up['jobId'],flush=True)
for _ in range(100):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert status=='SUCCEED'
for n,b in changes.items():
 for i in range(12):
  actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=259-editor-'+str(i),timeout=30).read()
  if actual==b:break
  time.sleep(2)
 assert actual==b,n
q=r/'docs/merchant-staff-settlements-publication-259.json';v=json.loads(q.read_text());v['policyEditorHosting']={'jobId':up['jobId'],'status':status,'changedFiles':list(changes),'unrelatedEntriesPreserved':True,'hostedBytesVerified':True};q.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');print('PASS Arabic policy editor labels and cache reference; other hosted files preserved.',flush=True)
