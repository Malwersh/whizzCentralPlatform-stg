from pathlib import Path
import json,csv,io,datetime,shutil
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';status='PUBLISHED_STAGING_INSTALLED_HUMAN_ACCEPTANCE_PENDING'
def read(p):return json.loads(p.read_text())
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
pub=read(R/'docs/driver-performance-publication-272.json');assert pub['verification']['status']=='PASS'
pub['native']={'build':272,'mode':'Release','installed':True,'launched':True,'device':'B8850CE6-BCC2-551D-B930-3E108456B23F','uninstalled':False}
pub['verification']['checks'].append('Anonymous GET performance and POST displayed returned401')
pub['status']=status;pub['completedAtUTC']=datetime.datetime.now(datetime.timezone.utc).isoformat();write(R/'docs/driver-performance-publication-272.json',pub)
p=R/'docs/driver-performance-policy-272.json';v=read(p);v['status']=status;v['verification']['installed']=True;v['verification']['publishedVerification']='PASS';v['approval']={'state':'EXPLICIT_USER_APPROVAL_RECEIVED','actionExecuted':True,'priorAutomaticRejectionResolvedByUserApproval':True};v['humanAcceptance']='PENDING_DISPLAYED_TIMEOUT_AND_ADMIN_DECISION';v['publication']='docs/driver-performance-publication-272.json';write(p,v)
for name in ['driver-performance-policy-272.json','driver-performance-publication-272.json']:
 shutil.copyfile(R/'docs'/name,D/'docs'/name)
p=R/'docs/driver-performance-packages-272.json';v=read(p);v['status']='PUBLISHED_STAGING_VERIFIED';v['publication']='docs/driver-performance-publication-272.json';write(p,v)
p=R/'docs/cod-launch-execution-tracker.json';v=read(p);v['driverPerformancePolicy272'].update(status=status,published=True,installed=True,userApproval=True,fullMetricsComplete=False)
def walk(x):
 if isinstance(x,dict):
  if x.get('activeSubtask')=='DRIVER_PERFORMANCE_POLICY_PHASE1':x['activeSubtaskStatus']=status
  for a in x.values():walk(a)
 elif isinstance(x,list):
  for a in x:walk(a)
walk(v);write(p,v)
p=R/'docs/main-plan-all-apps-priority-review-2026-10-24.json';v=read(p)
for row in v['workItems']:
 if row['id']=='D08':row.update(currentStatus=status,remaining='نُشرت وثُبتت نسخة272: إثبات ظهور العرض واحتساب انتهاء المهلة، وقرار أداء مستقل لكل محاولة. تبقى تجربة بشرية لانتهاء المهلة وقرار الإدارة؛ لا عقوبات أهلية جديدة.')
 if row['id']=='D10':row.update(currentStatus='PHASE1_PUBLISHED_ADVANCED_METRICS_OPEN',remaining=row['remaining'].replace('جاهزة ومختبرة قبل النشر','نُشرت وثُبتت واختُبرت تقنيًا؛ القبول البشري معلق'))
for u in v.get('executionUpdates',[]):
 if u.get('id')=='DRIVER_PERFORMANCE_POLICY_272':u.update(status=status,published=True,installed=True,userApproval=True,priorAutoReviewRejectionResolved=True,next='Human displayed-timeout and independent admin decision tests; punctuality/quality/activity and indicator history/review remain open')
write(p,v)
# Preserve all CSV fields and update only the two affected rows.
p=R/'docs/main-plan-all-apps-priority-review-2026-10-24.csv'
with p.open(newline='')as f:r=csv.DictReader(f);fields=r.fieldnames;rows=list(r)
for row in rows:
 item=next((a for a in v['workItems']if a['id']==row['المعرف'] and a['id']in ['D08','D10']),None)
 if item:row['الحالة']=item['currentStatus'];row['المتبقي']=item['remaining']
with p.open('w',newline='')as f:w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
# Keep generator definitions consistent without regenerating historical execution evidence.
p=R/'scripts/reconcile-main-plan-priorities-20261024.py';s=p.read_text();s=s.replace('PUBLISHED_V1_V2_READY_WRITE_APPROVAL_REQUIRED',status).replace('FOUNDATION_PHASE1_READY_ADVANCED_METRICS_OPEN','PHASE1_PUBLISHED_ADVANCED_METRICS_OPEN').replace('نسخة272 جاهزة محليًا: إثبات ظهور أزرار العرض وانتهاء المهلة، وقرار أداء مستقل مرتبط بالمحاولة. النشر الجديد متوقف على موافقة كتابة صريحة بعد رفض المراجعة الآلية؛ النسخة المنشورة271 باقية.','نُشرت وثُبتت نسخة272؛ تبقى تجربة بشرية لانتهاء المهلة وقرار الأداء المستقل.').replace('جاهزة ومختبرة قبل النشر','منشورة ومثبتة؛ القبول البشري معلق');p.write_text(s)
note='\n\nSuperseding publication checkpoint272: explicit user publication approval received. All three tested Lambda candidates published and downloaded byte-identical; IAM receipt policy exact/simulated allowed; hosted job203 SUCCEED with all four changed files byte-verified. Release272 installed and launched on real iMohammed without uninstall; anonymous new routes401. No live case decision, wallet/ledger write or support message by agent. Human displayed-timeout and independent case performance decision tests remain PENDING. This completes phase1 publication only: punctuality, quality, activity, indicator history/review and appeals remain open; no new hard eligibility/ranking/score/tier policy. See driver-performance-publication-272.json.\n'
for p in [R/'docs/resume-checkpoint-latest.md',D/'docs/resume-checkpoint-latest.md',R/'docs/finance-pricing-settlements-returns-unified-plan.md']:
 with p.open('a')as f:f.write(note)
print('Publication evidence and plans reconciled; human acceptance and advanced metrics remain open.')
