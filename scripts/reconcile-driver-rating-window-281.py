from pathlib import Path
import json,csv,io
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg'
f=R/'docs/driver-rating-window-publication-281.json';report=json.loads(f.read_text());assert report['status']=='PUBLISHED_STAGING'and len(report['functions'])==2;assert report['indexVerification']['status']=='VERIFIED'
assert 'Launched application'in Path('/private/tmp/ratings-window-281-launch.log').read_text();assert 'installationURL'in Path('/private/tmp/ratings-window-281-install.log').read_text()
report['explicitApprovalEvidence']='docs/driver-rating-window-approval-281.json';report['device']={'release':281,'installed':True,'launched':True,'sessionPreserved':True,'testLocationUnchanged':True};report['automatedTests']={'capturedRuntimeAndMetadata':87,'flutterPerformanceAndMore':21,'changeSetGuard':'PASS'}
f.write_text(json.dumps(report,indent=2)+'\n');(D/'docs/driver-rating-window-publication-281.json').write_bytes(f.read_bytes())
for name in ['driver-rating-window-changeset-281.json','driver-rating-window-infrastructure-281.json']:
 p=R/'docs'/name;j=json.loads(p.read_text());j['status']='EXECUTED_STACK_UPDATE_COMPLETE_INDEX_ACTIVE';j['indexStatus']='ACTIVE';j['executed']=True;p.write_text(json.dumps(j,indent=2)+'\n')
for name in ['driver-rating-window-approval-281.json','driver-rating-window-policy-281.json','driver-rating-window-changeset-281.json']:(D/'docs'/name).write_bytes((R/'docs'/name).read_bytes())
status='PUBLISHED_STAGING_MANUAL_ACCEPTANCE_DEFERRED'
for dest in [R,D]:
 p=dest/'docs/driver-rating-window-281.json';j=json.loads(p.read_text());j['status']=status;j['publication']['previousAutoReviewRejection']=j['publication'].pop('rejection','');j['publication'].update(executed=True,status='PUBLISHED_STAGING',approvalResolved=True,liveUnchanged='281; central hosting206 unchanged',onlyCloudWriteSoFar='Explicitly approved limited read policy, metadata preparation, index change set and two Lambda packages',evidence='docs/driver-rating-window-publication-281.json');j['implementation']['client']='Release281 built, installed and launched; all-time More header and V4 last100 indicator explicitly distinguished.';j['remaining']=[s for s in j['remaining']if not s.startswith('Explicitly approved publication')];p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
 p=dest/'docs/driver-performance-ordered-acceptance-tests.json';j=json.loads(p.read_text())
 for t in j['tests']:
  if t.get('id')=='RATING_WINDOW_281':t['status']='DEFERRED_READY';t['publication']='docs/driver-rating-window-publication-281.json'
 p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
 p=dest/'docs/driver-performance-ordered-acceptance-tests.md';p.write_text(p.read_text()+'\nتأكيد281: بعد الموافقة الصريحة نُشرت الخدمتان وتحقق الفهرسACTIVE والمصدر، وثُبّت Release281. اختبارRATING_WINDOW_281 جاهز لكنه مؤجل ولم ينجح عمليًا بعد.\n')
p=R/'docs/main-plan-all-apps-priority-review-2026-10-24.json';j=json.loads(p.read_text())
def walk(v):
 if isinstance(v,dict):
  if v.get('id')in ['D09','D10']:
   v['ratingWindow281'].update(status=status,published=True);v['currentStatus']='LAST100_RATING_WINDOW_281_PUBLISHED_QUALITY_INCIDENTS_OPEN';v['remaining']='نُشرت مراجعة التقييمات280 ونافذة آخر100تقييم صالح281 مع الترتيب والمراجعة والاستبعاد والاعتراض والملء من الأقدم. متوسط السجل الكامل محفوظ ومنفصل، والقراءة الناقصة مبدئية. المتبقي حوادث الجودة والسلامة المستقلة وأدلتها ومالكها وقرارها واعتراضها، ثم أهلية المركبة والوثائق والمنطقة. القبول العملي مؤجل؛ لا درجات أو مستويات أو عقوبات أهلية أو سياسة ترتيب جديدة.'
  for x in v.values():walk(x)
 elif isinstance(v,list):
  for x in v:walk(x)
walk(j);p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=R/'docs/main-plan-all-apps-priority-review-2026-10-24.csv';rows=list(csv.DictReader(io.StringIO(p.read_text())));fields=list(rows[0])
for row in rows:
 if row['المعرف']in ['D09','D10']:row['الحالة']='LAST100_RATING_WINDOW_281_PUBLISHED_QUALITY_INCIDENTS_OPEN';row['المتبقي']='نافذة100ومراجعةالتقييم منشورتان281/280؛ حوادثالجودةوالسلامة المستقلة ثمأهليةالمركبةوالوثائقوالمنطقة مفتوحة. القبولالعملي مؤجل؛ لا خلط بين المتوسط الكامل ونافذةالأداء.'
with p.open('w',newline='')as handle:w=csv.DictWriter(handle,fieldnames=fields);w.writeheader();w.writerows(rows)
p=R/'docs/cod-launch-execution-tracker.json';j=json.loads(p.read_text());j['currentOperationalBatch'].update(activeSubtask='DRIVER_EVIDENCED_QUALITY_SAFETY_INCIDENTS',activeSubtaskStatus='NEXT_IMPLEMENTATION_RATING_WINDOW281_PUBLISHED_MANUAL_TESTS_DEFERRED');j['driverRatingWindow281']['status']=status;p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
note='\n\n## تأكيد281 بعد الموافقة الصريحة\n\nتم تنفيذ معاينة الفهرس مع التبعيات الحالية دون استبدال الجدول، والتحقق منACTIVEوتغطية المصدر وصلاحيةGetItem/Query المحدودة لدورالسائق. نُشرت خدمتاالتقييمات/السائق وتحققت الحزم بايتًا ببايت والإعدادات؛ Release281 مثبت ومشغل مع حفظ الجلسة والموقعالاختباري. الأصواتوالتعليقات ومتوسطالسجل الكامل والأموال محفوظة. لا قرارات على تقييماتحقيقية بواسطةالوكيل. راجعdriver-rating-window-publication-281.json. اختبارنافذة100 مؤجل وغيرناجح عمليًا بعد. التالي حوادثالجودةوالسلامة الموثقة والمراجعةوالاعتراض، ثمأهليةالمركبة/الوثائق/المنطقة؛ لا تعديل لاستيرادالمنتجات المحالل للزميل ولاScoreأومستويات أوعقوباتتلقائية.\n'
for dest in [R,D]:
 p=dest/'docs/resume-checkpoint-latest.md';p.write_text(p.read_text()+note)
p=R/'docs/finance-pricing-settlements-returns-unified-plan.md';p.write_text(p.read_text()+note)
print('Published281, device and main-plan checkpoints reconciled; manual tests deferred.')
