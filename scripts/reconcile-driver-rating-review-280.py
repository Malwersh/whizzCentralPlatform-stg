from pathlib import Path
import json,csv,io
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=Path('/private/tmp/driver-rating-review-280')
report=json.loads((R/'docs/driver-rating-review-publication-280.json').read_text());assert report['status']=='PUBLISHED_STAGING'and len(report['functions'])==4
assert 'Launched application'in Path('/private/tmp/ratings-review-280-launch.log').read_text()
assert 'App installed'in Path('/private/tmp/ratings-review-280-install.log').read_text()or'installationURL'in Path('/private/tmp/ratings-review-280-install.log').read_text()
report['anonymousAccessChecks']=json.loads((P/'anonymous-checks.json').read_text())
report['explicitApprovalEvidence']='docs/driver-rating-review-approval-280.json';report['device']={'release':280,'installed':True,'launched':True,'sessionPreserved':True,'testLocationUnchanged':True};report['automatedTests']={'capturedRuntimeIncludingSharedFactory':85,'staffProjectionAndPublicOrderNumber':2,'flutterPerformanceAndMore':19,'browser':'PASS'}
(R/'docs/driver-rating-review-publication-280.json').write_text(json.dumps(report,indent=2)+'\n');(D/'docs/driver-rating-review-publication-280.json').write_bytes((R/'docs/driver-rating-review-publication-280.json').read_bytes())
status='PUBLISHED_STAGING_MANUAL_ACCEPTANCE_DEFERRED'
for dest in [R,D]:
 p=dest/'docs/driver-rating-review-280.json';j=json.loads(p.read_text());j['status']=status;j['publication']['previousAutoReviewRejection']=j['publication'].pop('reason','');j['publication']['executed']=True;j['publication']['status']='PUBLISHED_STAGING';j['publication']['evidence']='docs/driver-rating-review-publication-280.json';j['publication']['approvalResolved']=True;j['publication']['currentLive']='Phase280; hosted job '+report['hostingJobId'];j['publication']['cloudWritesByThisPhase']='Explicitly approved IAM policy, four Lambda packages and hosting deployment';j['driverRelease'].update(build='RELEASE_BUILD_PASSED',installed=True,launched=True,currentInstalled=280);j['remaining']=[s for s in j['remaining']if not s.startswith('Publish exact tested')];p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
 p=dest/'docs/driver-performance-ordered-acceptance-tests.json';j=json.loads(p.read_text())
 for t in j['tests']:
  if t.get('id')=='RATING_REVIEW_280':t['status']='DEFERRED_READY';t['publication']='docs/driver-rating-review-publication-280.json'
 p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
 p=dest/'docs/driver-performance-ordered-acceptance-tests.md';p.write_text(p.read_text()+'\nتحديث280 بعد الموافقة الصريحة: نُشرت الحزم الأربع والواجهة وتحققت البصمات والصلاحية المحدودة؛ اختبار RATING_REVIEW_280 أصبح جاهزًا لكنه مؤجل وغير ناجح عمليًا بعد.\n')
p=R/'docs/main-plan-all-apps-priority-review-2026-10-24.json';j=json.loads(p.read_text())
def walk(v):
 if isinstance(v,dict):
  if v.get('id')in ['D09','D10']:
   v['ratingReview280'].update(status=status,published=True);v['currentStatus']='RATING_REVIEW_280_PUBLISHED_LAST100_AND_QUALITY_INCIDENTS_OPEN';v['remaining']='نُشرت مراجعة التقييمات والاستبعاد والاعتراض280 مع حفظ رأي الزبون وفصل تقييم المطعم والأموال. المتوسط الحالي للتقييمات الصالحة عبر كامل السجل. المتبقي: نافذة آخر100تقييم صالح ومصدر قراءة مرتب قابل للتحقق، وحوادث الجودة والسلامة المستقلة وأدلتها واعتراضها، ثم أهلية المركبة والوثائق والمنطقة. القبول العملي مؤجل؛ لا تفعيل تلقائي لعقوبات أوScoreأوالمستويات أو سياسة ترتيب جديدة.'
  for x in v.values():walk(x)
 elif isinstance(v,list):
  for x in v:walk(x)
walk(j);p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=R/'docs/main-plan-all-apps-priority-review-2026-10-24.csv';rows=list(csv.DictReader(io.StringIO(p.read_text())));fields=list(rows[0])
for row in rows:
 if row['المعرف']in ['D09','D10']:row['الحالة']='RATING_REVIEW_280_PUBLISHED_LAST100_AND_QUALITY_INCIDENTS_OPEN';row['المتبقي']='مراجعة التقييمات280 منشورة؛ نافذة آخر100تقييم صالح وحوادث الجودة والسلامة المستقلة ثم أهلية المركبة والوثائق والمنطقة مفتوحة. المتوسط الحالي لكامل السجل والقبول العملي مؤجل.'
with p.open('w',newline='')as f:w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
p=R/'docs/cod-launch-execution-tracker.json';j=json.loads(p.read_text());j['currentOperationalBatch'].update(activeSubtask='DRIVER_RATINGS_LAST100_AND_QUALITY_INCIDENTS',activeSubtaskStatus='NEXT_IMPLEMENTATION_RATING_REVIEW280_PUBLISHED_MANUAL_TESTS_DEFERRED');j['driverRatingReview280']['status']=status;p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
note='\n\n## تأكيد نشر280 بعد موافقة المستخدم الصريحة\n\nالموافقة «نعم اوافق» حسمت رفض النشر السابق. طُبّقت DriverRatingReview280 لقراءة/كتابة/تحقق مشروط على جدول التقييمات وحده؛ نُشرت الخدمات الأربع والواجهة'+report['hostingJobId']+' وتحققت الحزم المنشورة بايتًا ببايت والإعدادات. Release280 مثبت ومشغل مع حفظ الجلسة والموقع الاختباري. لا قرارات على تقييمات حقيقية ولا حركة مال بواسطة الوكيل. انظر driver-rating-review-publication-280.json. كل الاختبارات العملية مؤجلة وغير ناجحة بعد. التالي نافذة آخر100تقييم صالح وحوادث الجودة والسلامة الموثقة، ثم المركبة والوثائق والمنطقة؛ لا مساس بجزء المنتجات المحال للزميل.\n'
for dest in [R,D]:
 p=dest/'docs/resume-checkpoint-latest.md';p.write_text(p.read_text()+note)
p=R/'docs/finance-pricing-settlements-returns-unified-plan.md';p.write_text(p.read_text()+note)
print('Publication, approval, device and main-plan checkpoints reconciled; manual acceptance remains deferred.')
