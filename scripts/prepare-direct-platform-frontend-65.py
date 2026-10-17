"""Build a narrow overlay on the current Amplify archive, preserving other teams' files."""
import pathlib,json,zipfile,copy,re,hashlib,difflib,base64
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance65')
def main():
 changes={n:(R/'frontend'/n).read_bytes() for n in ['staff.js','delivery-pricing.js','commercial-management.js','settings.js','settings-delivery-operations.js','finance.js']}
 with zipfile.ZipFile(O/'frontend-latest.zip') as old:
  for n,b in changes.items():
   diff=list(difflib.unified_diff(old.read(n).decode().splitlines(),b.decode().splitlines(),n,n,n=1));(O/('frontend-'+n+'.diff')).write_text('\n'.join(diff));assert len(diff)<150,'UNEXPECTED_UI_DRIFT '+n
  for n in ['pages/staff.html','pages/delivery-pricing.html','pages/settings.html','pages/merchants.html','pages/promotions.html','pages/finance.html']:
   s=old.read(n).decode()
   s=s.replace('مسودة بإصدار مستقل واعتماد من موظف آخر. الاتفاقيات تحتاج موافقة المالك قبل الاعتماد، وتبقى الشروط السابقة سارية حتى اكتمال ذلك.','إدارة الشروط المالية لكل فرع. تسري الاتفاقية بعد موافقة المالك على شروطها.')
   s=s.replace('يمكن للموظف امتلاك أكثر من دور. تعديل الأدوار أو النطاق يحتاج اعتماد موظف مستقل مخوّل.','يمكن للموظف امتلاك أكثر من دور. احفظ الأدوار والنطاق لتطبيق التعديل.')
   s=s.replace('التعديلات تحتاج اعتماد موظف مخوّل مستقل وتُحفظ في سجل التدقيق.','تُحفظ التعديلات في سجل التدقيق.')
   s=s.replace('إثبات واعتماد مالي مستقل','إثبات مالي').replace('إرسال للاعتماد','حفظ').replace('إرسال التعديل للاعتماد','حفظ الإعدادات').replace('سبب حفظ المسودة','سبب التعديل').replace('اقتراح تعديل الإعدادات','حفظ الإعدادات')
   s=s.replace('تُحسب الحدود اليومية وفق يوم بغداد. كل تعديل يحتاج اعتماد مدير مالي آخر. منع التكرار والخصم من المحجوز والفصل بين المنشئ والمعتمد ضمانات إلزامية.','تُحسب الحدود اليومية وفق يوم بغداد. تُطبق التعديلات عند الحفظ، مع منع التكرار وحماية الرصيد المحجوز.')
   s=s.replace('رسوم الزبون وأجرة السائق مستقلتان. حفظ المسودة لا ينشر الأسعار؛ النشر يحتاج اعتماد موظف آخر. الأسعار المؤكدة للطلبات وعروض السائق المقبولة تحتفظ بنسختها عند ربط التطبيقات.','تُحفظ رسوم الزبون وأجرة السائق بإصدارات منفصلة. تُطبق الأسعار عند الحفظ؛ الطلبات وعروض السائق المقبولة تحتفظ بأسعارها المثبتة.')
   s=s.replace('إضافة التعديل هنا محلية؛ استخدم «حفظ المسودة» لحفظه في المنصة.','راجع التعديلات ثم اضغط «حفظ الأسعار» لتطبيقها في المنصة.')
   # Cache-bust only the modified scripts; keep every other live asset untouched.
   for js in changes:s=re.sub(r'(src="\.\./'+re.escape(js)+r')(?:\?[^"\s]*)?("|\')',r'\1?v=65\2',s)
   changes[n]=s.encode()
  with zipfile.ZipFile(O/'frontend.candidate.zip','w',zipfile.ZIP_DEFLATED) as new:
   for info in old.infolist():new.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  with zipfile.ZipFile(O/'frontend.candidate.zip') as new:assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in changes)
  p=json.loads((O/'preparation.json').read_text());p['frontend']={'baseJobId':json.loads((O/'frontend-latest.json').read_text())['jobId'],'changedFiles':list(changes),'preservedFiles':len(old.namelist())-len(changes),'codeSha256':base64.b64encode(hashlib.sha256((O/'frontend.candidate.zip').read_bytes()).digest()).decode()};(O/'preparation.json').write_text(json.dumps(p,indent=2));print(json.dumps(p['frontend']))
if __name__=='__main__':main()
