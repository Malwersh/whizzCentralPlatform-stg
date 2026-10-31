from pathlib import Path
import zipfile,copy,json
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-272');old=zipfile.ZipFile(P/'web-base.zip');changes={}
s=old.read('order-exception-cases.js').decode()
for needle,replacement in [
 ('const errors={',"const errors={DRIVER_PERFORMANCE_DECISION_CONFLICT:'تغير قرار الأداء أو نسخة القضية؛ حدّث الحالة قبل إعادة القرار.',INVALID_DRIVER_PERFORMANCE_DECISION:'راجع المحاولة والأثر والتعليل والأدلة.',DRIVER_PERFORMANCE_ATTEMPT_UNAVAILABLE:'تعذر مطابقة محاولة السائق؛ لا يمكن تطبيق القرار على محاولة أخرى.',DRIVER_PERFORMANCE_APPEAL_OPEN:'يوجد اعتراض مفتوح؛ لا يحتسب قرار سلبي قبل مراجعته.',"),
 ("const reason=window.WizzCaseUI?window.WizzCaseUI.reason(kind):el('case-reason').value.trim();","const reason=(extra.reason??(window.WizzCaseUI?window.WizzCaseUI.reason(kind):el('case-reason').value)).trim();"),
 ("else text(el('message'),'اكتب سببًا أو ملاحظة من خمسة أحرف على الأقل.');return;","else text(el('message'),'اكتب سببًا أو ملاحظة من خمسة أحرف على الأقل.');return false;"),
 ("text(el('message'),notice);}}catch(e){","text(el('message'),notice);}return true;}catch(e){"),
 ("else showError(e.message);}finally{state.busy=false;lock();}}","else showError(e.message);return false;}finally{state.busy=false;lock();}}"),
 ("window.WizzCaseContinuation?.render(item,events,{submit:action,api,canOperate:state.canOperate});","window.WizzCaseContinuation?.render(item,events,{submit:action,api,canOperate:state.canOperate});window.WizzDriverPerformanceCase?.render(item,events,{submit:action,canOperate:state.canOperate});"),
 ('function autoRefresh(){if(','function autoRefresh(){if(window.WizzDriverPerformanceCase?.hasDraft()||')]:
 assert s.count(needle)==1,needle;s=s.replace(needle,replacement,1)
changes['order-exception-cases.js']=s.encode();changes['driver-performance-case.js']=(R/'frontend/driver-performance-case.js').read_bytes()
s=old.read('case-workflow.js').decode();needle="SET_RESPONSIBILITY:'قرار المسؤولية',";assert s.count(needle)==1;s=s.replace(needle,"SET_DRIVER_PERFORMANCE:'أثر الحالة على أداء السائق',"+needle,1);changes['case-workflow.js']=s.encode()
s=old.read('pages/order-exceptions.html').decode();needle='<script src="../order-exception-cases.js?';assert s.count(needle)==1;s=s.replace(needle,'<script src="../driver-performance-case.js?v=272"></script>'+needle,1)
import re
s=re.sub(r'(order-exception-cases.js\?v=)[^\"]+',r'\g<1>272',s);s=re.sub(r'(case-workflow.js\?v=)[^\"]+',r'\g<1>272',s);changes['pages/order-exceptions.html']=s.encode()
with zipfile.ZipFile(P/'web-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
 for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 for name,value in changes.items():
  if name not in old.namelist():out.writestr(name,value)
new=zipfile.ZipFile(P/'web-candidate.zip');assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes)
(P/'web-changes.json').write_text(json.dumps(list(changes)));print('Hosted candidate prepared:',list(changes))
