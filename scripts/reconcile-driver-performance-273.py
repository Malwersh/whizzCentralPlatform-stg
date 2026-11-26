from pathlib import Path
import json,datetime,csv,shutil
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';status='PUBLISHED_STAGING_INSTALLED_MANUAL_ACCEPTANCE_DEFERRED'
def load(p):return json.loads(p.read_text())
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
pub=load(R/'docs/driver-performance-publication-273.json');assert pub['status']=='PUBLISHED_STAGING'and len(pub['functions'])==2
pub.update(status=status,completedAtUTC=datetime.datetime.now(datetime.timezone.utc).isoformat(),native={'build':273,'mode':'Release','installed':True,'launched':True,'device':'B8850CE6-BCC2-551D-B930-3E108456B23F','uninstall':False},unauthenticatedRouteCheck='GET rules=3 returned401');save(R/'docs/driver-performance-publication-273.json',pub)
policy={'status':status,'rulesVersion':'OBSERVED_DRIVER_PERFORMANCE_V3','scope':'Original per-attempt punctuality observations, bounded thirty-day acceptance activity and indicator event detail','implemented':['Immutable original timing plan saved with accepted offer and order in same acceptance transaction','Existing five-minute ETA tolerance pinned as policy ORIGINAL_ACCEPTED_ROUTE_V1','Prior attempt arrival and pickup observations cleared atomically when replacement accepts','First server arrival/pickup time retained on retry and update fenced to strongly-read offer and attempt','Punctuality requires same assignment, settled delivery and ordered server-recorded store/pickup/customer/delivery times','Missing original targets or incomplete events excluded without retroactive blame','Possible pickup waiting delay remains REVIEW; self report, changed ETA and compensation do not establish excuse or fault','Timing is an observed service metric, not GPS evidence or automatic driver fault','Thirty-day verified acceptance activity with explicit partial lower-bound and legacy exclusions; not completed trips or online hours','Arabic own-event detail sheets for acceptance, completion and timing; Baghdad timestamps and no internal UUID labels','V1/V2 clients retain their prior response contracts; new client opts into rules=3'],
'verification':{'sourceDriverChecks':47,'sourceCentralChecks':31,'capturedActualModernAcceptanceChecks':28,'capturedLegacyAcceptanceChecks':14,'capturedDriverChecks':47,'flutterChecks':22,'typescript':'PASS','nativeBuild':'Release273','downloadedLambdaBytes':'IDENTICAL_TO_TESTED_CANDIDATES','unrelatedPackageEntries':'UNCHANGED','analyzer':'No errors or warnings; existing service print/style infos remain','unsupportedLegacyTest':'Old eta98 module does not support full-cash by design; that test is validated against actual modern index acceptance, not claimed supported on old helper'},
'publication':'docs/driver-performance-publication-273.json','packages':'docs/driver-performance-packages-273.json','humanAcceptance':'DEFERRED_BY_USER_NOT_PASSED','orderedTests':'docs/driver-performance-ordered-acceptance-tests.json','businessWritesByAgent':0,'financialCalculationChanged':False,'newPermissions':False,'rankingOrHardEligibilityChanged':False,
'remaining':['Evidence-backed administrative resolution of delay exceptions and performance appeals/review ownership','Verified quality incidents and customer rating moderation/exclusion/appeals and rating window','Further activity statistics require authoritative completion/availability history; no fabricated lifetime totals or online hours','Complete operational source integration before vehicle/documents/region; score/tiers/ranking remain deferred']}
save(R/'docs/driver-performance-timing-273.json',policy)
p=R/'docs/driver-performance-packages-273.json';v=load(p);v['status']='PUBLISHED_STAGING_VERIFIED';save(p,v)
p=R/'docs/driver-performance-ordered-acceptance-tests.json';v=load(p)
for t in v['tests']:
 if t['id']=='T10':t.update(status='DEFERRED_READY_OBSERVATIONS_DELAY_DECISION_PHASE_OPEN',implementationEvidence='docs/driver-performance-timing-273.json',note='الأوقات الأصلية والملاحظة والمراجعة متاحة؛ حسم الأعذار إداريًا بالأدلة ما زال ضمن المتبقي، ولا يعتبر هذا السيناريو ناجحًا.')
 if t['id']=='T11':t['activityAcceptanceScopeReady']=True
 if t['id']=='T12':t.update(status='DEFERRED_READY_ACCEPTANCE_COMPLETION_TIMING',remainingScope='Quality/rating event history remains open')
v['nextImplementation']='مراجعة الجودة والتقييمات والاستبعاد والاعتراض، وحسم استثناءات التأخير بالأدلة، ثم اعتماد المركبة والوثائق والمنطقة.'
save(p,v)
with (R/'docs/driver-performance-ordered-acceptance-tests.md').open('a')as f:f.write('\n\nتحديث الدفعة273: أُنجزت ملاحظة الالتزام بالمواعيد الأصلية، وتفاصيل القبول والإكمال والوقت ونشاط القبول لآخر30يومًا. اختبارات T10 وT12 جاهزة ضمن هذا النطاق لكنها مؤجلة وغير ناجحة بعد. حسم عذر التأخير إداريًا، والجودة ومراجعة التقييم والاعتراض، ما زالت مفتوحة. نشاط القبول ليس ساعات عمل ولا عدد رحلات مكتملة.\n')
p=R/'docs/cod-launch-execution-tracker.json';v=load(p);v['driverPerformanceTiming273']={'status':status,'evidence':'docs/driver-performance-timing-273.json','fullMetricsComplete':False,'manualTestsDeferred':True}
def walk(x):
 if isinstance(x,dict):
  if x.get('activeSubtask')=='DRIVER_PERFORMANCE_PUNCTUALITY_QUALITY_ACTIVITY':x.update(activeSubtask='DRIVER_PERFORMANCE_QUALITY_RATING_DELAY_REVIEW',activeSubtaskStatus='NEXT_IMPLEMENTATION_MANUAL_TESTS_DEFERRED')
  for y in x.values():walk(y)
 elif isinstance(x,list):
  for y in x:walk(y)
walk(v);save(p,v)
p=R/'docs/main-plan-all-apps-priority-review-2026-10-24.json';v=load(p)
for row in v['workItems']:
 if row['id']=='D10':row.update(currentStatus='PHASE2_TIMING_ACTIVITY_DETAILS_PUBLISHED_REVIEW_QUALITY_OPEN',remaining='نُشرت273: المواعيد الأصلية لكل محاولة ومؤشر الوقت وتفاصيل الأحداث ونشاط القبول لآخر30يومًا. المتبقي: حسم استثناءات التأخير بالأدلة وملكية المراجعة والاعتراض، والجودة ومراجعة التقييمات؛ إحصاءات النشاط الأوسع تحتاج مصادرها. لا تفعيل تلقائي للعقوبات أوScoreأوالمستويات أوالترتيب.')
 if row['id']in ['D08','D10']:
  if 'docs/driver-performance-timing-273.json'not in row['sourceOrEvidence']:row['sourceOrEvidence'].append('docs/driver-performance-timing-273.json')
v.setdefault('executionUpdates',[]).append({'id':'DRIVER_PERFORMANCE_TIMING_273','status':status,'evidence':'docs/driver-performance-timing-273.json','businessWrites':0,'fullMetricsComplete':False,'next':policy['remaining']});save(p,v)
p=R/'docs/main-plan-all-apps-priority-review-2026-10-24.csv'
with p.open(newline='')as f:r=csv.DictReader(f);fields=r.fieldnames;rows=list(r)
for row in rows:
 item=next((a for a in v['workItems']if a['id']==row['المعرف']and a['id']in ['D08','D10']),None)
 if item:row['الحالة']=item['currentStatus'];row['المتبقي']=item['remaining'];row['مراجع']=' | '.join(item['sourceOrEvidence'])
with p.open('w',newline='')as f:w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
note='\n\nPerformance273 published/installed on staging with byte-verified financial/driver Lambda candidates and unchanged config, no new IAM or financial calculations. Original timing per accepted attempt, first progress timestamps/attempt fences, observation-only punctuality, bounded thirty-day acceptance activity and Arabic event details.78 source backend,89 captured checks,22 Flutter checks, TS and Release273 build pass. Human tests remain DEFERRED_NOT_PASSED by user. Potential pickup waiting delays remain review; no automatic fault/excuse from reports or compensation. Next: verified quality/rating review and evidence-backed delay resolution, then vehicle/documents/region. Full metrics and v1.6 score/tiers/ranking remain OPEN. See driver-performance-timing-273.json.\n'
for root in [R,D]:
 for name in ['driver-performance-timing-273.json','driver-performance-publication-273.json','driver-performance-ordered-acceptance-tests.json','driver-performance-ordered-acceptance-tests.md']:
  if root!=R:shutil.copyfile(R/'docs'/name,root/'docs'/name)
 with (root/'docs/resume-checkpoint-latest.md').open('a')as f:f.write(note)
with (R/'docs/finance-pricing-settlements-returns-unified-plan.md').open('a')as f:f.write(note)
print('Updated main plan and ordered deferred tests; quality and delay-review phases remain open.')
