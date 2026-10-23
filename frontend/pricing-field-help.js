'use strict';
(()=>{
 const fmt=n=>new Intl.NumberFormat('ar-IQ',{maximumFractionDigits:3}).format(n);
 window.attachPricingFieldHelp=(host,kind)=>{
  if(kind!=='delivery')return;
  const fields={
   base:['مبلغ بداية التوصيل (د.ع)','مبلغ ثابت يضاف مرة واحدة لكل طلب، ثم تضاف تكلفة المسافة. مثال: بداية ١٬٠٠٠ + تكلفة مسافة ١٬٥٠٠ = ٢٬٥٠٠ قبل الحدود والتقريب.'],
   perKm:['سعر كل كيلومتر من المطعم إلى الزبون (د.ع/كم)','يطبق على كامل مسافة الطريق الفعلية. مثال: ٣ كم × ٣٥٠ = ١٬٠٥٠ دينار، تضاف إلى مبلغ البداية. لا يشمل وصول السائق للمطعم.'],
   minimum:['أقل رسوم توصيل يدفعها الزبون (د.ع)','إذا كان الحساب أقل من هذا المبلغ يُرفع إليه. ليس الحد الأدنى لقيمة الطعام.'],
   maximum:['أعلى رسوم توصيل يدفعها الزبون (د.ع)','إذا تجاوز الحساب هذا المبلغ يُخفض إليه. هذا السقف لا يلغي أقصى مسافة التغطية. الحدود قبل خصومات التوصيل.'],
   longAfter:['تبدأ الزيادة الإضافية بعد مسافة (متر)','مثال: ٥٠٠٠ تعني أن الزيادة تبدأ بعد أول ٥ كم. صفر يعني أنها تبدأ من أول الطريق؛ لا يعني تعطيل الزيادة.'],
   longFlat:['مبلغ إضافي مرة واحدة عند تجاوز المسافة (د.ع)','يضاف فوق الحساب العادي مرة واحدة إذا تجاوز الطريق المسافة المحددة. صفر يعطل هذا المبلغ الثابت فقط.'],
   longKm:['زيادة فوق السعر العادي لكل كم بعد المسافة المحددة (د.ع/كم)','هذا مبلغ إضافي وليس بديلًا لسعر الكيلومتر العادي. مثال: بعد ٥ كم وبزيادة ٤٥٠، فإن طريقًا بطول ٧ كم يضيف ٩٠٠ دينار فوق الحساب العادي. ضع صفرًا إذا لا تريد هذه الزيادة.'],
   rounding:['تقريب الكسور الدقيقة أثناء الحساب','يعالج كسور مكونات الحساب أثناء ضرب المسافة بالسعر. وحدة تقريب رسوم التوصيل النهائية تُحدد في الحقل التالي.'],
   finalIncrement:['اجعل رسوم التوصيل من مضاعفات هذا المبلغ (د.ع)','مثال: ٢٥٠ يجعل النتيجة مثل ١٬٥٠٠ أو ١٬٧٥٠ أو ٢٬٠٠٠. لا يحدد سعر الكيلومتر ولا رسوم الخدمة.'],
   finalMode:['كيف نختار مضاعف المبلغ الأقرب؟','الأقرب؛ النصف للأعلى: مع وحدة ٢٥٠، تصبح ٢٬٣٦٠ ← ٢٬٢٥٠، وتصبح ٢٬٤٠٠ ← ٢٬٥٠٠. يطبق بعد الحدود.'],
   enabled:['هل التوصيل متاح بهذه القاعدة؟','اختيار «لا» يمنع التوصيل عند اختيار هذه القاعدة. لا يجعل الرسوم صفرًا.'],
   maxMeters:['أبعد طريق مسموح للمطعم إلى الزبون (متر)','١٥٠٠٠ تعني ١٥ كم. إذا تجاوز الطريق هذا الحد يُرفض التوصيل، حتى لو كانت الرسوم تحت الحد الأعلى.'],
   maxSeconds:['أطول وقت قيادة مسموح (ثانية)','٢٧٠٠ تعني ٤٥ دقيقة قيادة. لا يتضمن تحضير الطعام. تجاوز المسافة أو الوقت يكفي لرفض التوصيل.'],
   scope:['تطبيق السعر على','«عام» للفروع التي لا توجد لها قاعدة أخص مطابقة. «فرع» لاستثناء الفرع المحدد فقط.'],
   scopeId:['معرّف النطاق','يضبطه الاختيار. للنطاق العام يبقى GLOBAL؛ لا تكتب معرّف متجر هنا.'],
   from:['يبدأ تطبيق السعر في UTC','وقت بدء القاعدة. UTC أقل من توقيت العراق بثلاث ساعات. الطلبات المقبولة سابقًا تحتفظ بأسعارها.'],
   to:['ينتهي تطبيق السعر في UTC — اختياري','اتركه فارغًا لتستمر القاعدة دون تاريخ نهاية.'],
   id:['مرجع القاعدة الداخلي','معرّف تقني ينشئه النظام؛ اتركه كما هو. لا يؤثر رقمه في السعر.'],
   version:['نسخة القاعدة','١ للقاعدة الجديدة. عند تعديل قاعدة منشورة، يلزم إصدار أعلى لتوثيق التغيير.'],
   priority:['الأولوية بين قواعد النطاق نفسه','لا تحدد السعر. اتركها صفرًا لقاعدة عامة واحدة. تخصيص الفرع يتقدم على العامة بسبب نوع النطاق.'],
   fallback:['مرجع سياسة المسار التقديري — اختياري','اتركه فارغًا لاستخدام طريق فعلي موثوق. لا تكتب رقمًا عشوائيًا؛ يلزم وجود سياسة تقدير معتمدة.']
  };
  for(const [id,[title,description]]of Object.entries(fields)){
   const input=document.getElementById('rule-'+id);if(!input)continue;const label=input.parentElement;
   if(label.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent=title;
   const hint=document.createElement('small');hint.id='rule-'+id+'-help';hint.className='pricing-field-hint';hint.textContent=description;label.append(hint);input.setAttribute('aria-describedby',hint.id);
  }
  const banner=document.createElement('aside');banner.className='pricing-formula-help';banner.setAttribute('aria-live','polite');banner.setAttribute('role','status');host.prepend(banner);
  const n=id=>{const value=document.getElementById('rule-'+id)?.value;return value!==''&&Number.isFinite(Number(value))?Number(value):null;};
  const longGroup=document.getElementById('rule-longKm').closest('fieldset');longGroup.querySelector('legend').textContent='زيادة اختيارية تُضاف فوق السعر العادي للمسافات البعيدة';
  const tiers=document.getElementById('pricing-tiers');tiers.querySelector('legend').textContent='طريقة بديلة: مبلغ ثابت لكل فئة مسافة';tiers.querySelector('p').textContent='اختر هذه الطريقة بدل سعر كل كيلومتر: يختار النظام شريحة واحدة ويضيف مبلغها إلى البداية، ولا يجمع الشرائح. مثال توضيحي: حتى ٢ كم +٥٠٠، وحتى ٥ كم +١٥٠٠. يجب جعل سعر الكيلومتر العادي صفرًا. اتركها دون شرائح إذا كنت تستخدم سعر الكيلومتر.';
  function refresh(){
   const base=n('base'),rate=n('perKm'),after=n('longAfter'),flat=n('longFlat'),extra=n('longKm');banner.replaceChildren();const title=document.createElement('strong');title.textContent='كيف تتجمع المبالغ؟';banner.append(title);
   const p=document.createElement('p');p.textContent='مبلغ البداية + تكلفة المسافة + أي زيادة إضافية مفعّلة، ثم الحد الأدنى والأعلى والتقريب. هذا شرح للحقول قبل الاتفاقيات والخصومات، وليس عرض سعر نهائيًا.';banner.append(p);
   const enabled=(flat||0)>0||(extra||0)>0;
   if(enabled&&longGroup.parentElement.classList.contains('pricing-editor-advanced'))host.insertBefore(longGroup,host.querySelector('.pricing-editor-advanced'));
   banner.dataset.warning=String(enabled&&after===0);
   if(enabled&&after===0){const warning=document.createElement('p');warning.className='pricing-field-warning';warning.textContent='الزيادة الإضافية تبدأ حاليًا من صفر متر، لذلك تُضاف على كامل الطريق.';if(rate!==null&&extra!==null)warning.textContent+=' سعر الكيلومتر العادي '+fmt(rate)+' + الزيادة '+fmt(extra)+' = '+fmt(rate+extra)+' د.ع لكل كم.';if(flat)warning.textContent+=' ويضاف أيضًا مبلغ ثابت '+fmt(flat)+' د.ع لأي طريق يتجاوز صفر متر.';banner.append(warning);}
   else if(enabled){const line=document.createElement('p');line.textContent='تبدأ الزيادة بعد '+fmt(after||0)+' متر. وهي تُضاف فوق حساب المسافة العادي.';banner.append(line);}
   else{const line=document.createElement('p');line.textContent=base!==null&&rate!==null?'لا توجد زيادة للمسافة الطويلة: الحساب الأساسي '+fmt(base)+' د.ع + '+fmt(rate)+' د.ع لكل كم، قبل الحدود والتقريب.':'املأ مبلغ البداية وسعر الكيلومتر. اترك مبلغَي الزيادة الإضافية صفرًا إذا لا تريدها.';banner.append(line);}
  }
  for(const id of ['base','perKm','longAfter','longFlat','longKm'])document.getElementById('rule-'+id).addEventListener('input',refresh);refresh();
 };
})();
