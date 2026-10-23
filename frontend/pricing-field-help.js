'use strict';
(()=>{
 const fmt=n=>new Intl.NumberFormat('ar-IQ',{maximumFractionDigits:3}).format(n);
 function attachDriverHelp(host){
  const fields={
   base:['مبلغ ثابت للسائق عن كل طلب (د.ع)','يضاف مرة واحدة إلى أجرة الطلب، ثم تضاف تعويضات الوصول للمطعم والتوصيل والوقت المفعّلة. لا يشمل الإكرامية.'],
   pickupPerKm:['أجر كل كم للوصول إلى المطعم (د.ع/كم)','يطبق على طريق السائق إلى المطعم، بعد طرح المسافة المشمولة في الحقل التالي. مثال: مسافة ٣ كم وأول ١ كم مشمول، يُدفع عن ٢ كم فقط. ضع صفرًا لتعطيل تعويض الوصول بالكامل.'],
   pickupIncludedMeters:['مسافة الوصول دون تعويض إضافي (متر)','١٠٠٠ تعني أن أول كيلومتر إلى المطعم مشمول في أساس الأجرة ولا يُعوّض كمسافة إضافية. صفر يعني تعويض كامل طريق الوصول من أول متر؛ لا يعطّل التعويض.'],
   deliveryPerKm:['أجر كل كم من المطعم إلى الزبون (د.ع/كم)','يطبق على كامل طريق التوصيل من المطعم إلى الزبون. مثال: ٥ كم × ٤٠٠ = ٢٬٠٠٠ دينار، تضاف إلى المبلغ الثابت وتعويض الوصول. مستقل عن رسوم الزبون.'],
   perMinute:['تعويض دقيقة القيادة المحسوبة (د.ع/دقيقة)','يضاف مقابل مجموع وقتَي القيادة إلى المطعم ومنه إلى الزبون، وفق المسارين المحسوبين. ليس مؤقت الانتظار الفعلي أو وقت تحضير الطعام. صفر يعطّل تعويض الوقت.'],
   minimum:['أقل أجرة للسائق قبل الإكرامية (د.ع)','إذا كان مجموع مكونات الأجرة أقل من هذا الحد يُرفع إليه. لا يحدد رسوم الزبون ولا يخصم من الإكرامية.'],
   maximum:['أعلى أجرة للسائق قبل الإكرامية (د.ع)','إذا تجاوز مجموع مكونات الأجرة هذا الحد يُخفض إليه. راجعه حتى لا يحجب تعويضات مسافات طويلة تقصد دفعها. الإكرامية مستقلة.'],
   rounding:['تقريب الكسور الدقيقة داخل الحساب','يعالج كسور مكونات المسافة والوقت. مضاعفات أجرة السائق النهائية تُحدد في الحقل التالي.'],
   finalIncrement:['اجعل أجرة السائق من مضاعفات هذا المبلغ (د.ع)','مثال: ٢٥٠ يجعل الأجرة النهائية مثل ٢٬٠٠٠ أو ٢٬٢٥٠ أو ٢٬٥٠٠. هذا تقريب الأجرة، وليس تقريب فاتورة الزبون النقدية.'],
   finalMode:['طريقة تقريب أجرة السائق النهائية','الأقرب؛ النصف للأعلى: مع وحدة ٢٥٠ تصبح ٢٬٣٦٠ ← ٢٬٢٥٠، و٢٬٤٠٠ ← ٢٬٥٠٠. يطبق بعد الحدين الأدنى والأعلى.'],
   longAfter:['تبدأ زيادة المسافة البعيدة بعد (متر)','تخص طريق المطعم إلى الزبون فقط؛ الوصول إلى المطعم يُعوّض منفصلًا. صفر يبدأ الزيادة من أول الطريق ولا يعطّلها.'],
   longFlat:['زيادة ثابتة مرة واحدة عند تجاوز المسافة (د.ع)','تضاف فوق أجرة السائق عند تجاوز المسافة المحددة. صفر يعطّل هذه الزيادة الثابتة فقط.'],
   longKm:['زيادة فوق أجر الكيلومتر بعد المسافة المحددة (د.ع/كم)','إضافة إلى أجر كيلومتر التوصيل، وليست بديلًا عنه. مثال: بعد ٥ كم، طريق ٧ كم يستحق الزيادة عن ٢ كم فقط. صفر يعطّل هذا المكوّن.'],
   vehicle:['المركبات التي تطبق عليها القاعدة','فارغ يعني جميع المركبات. تخصيص نوع مركبة يحتاج القيمة المعتمدة لذلك النوع؛ لا تغيّرها دون قصد.'],
   scope:['على مَن تطبق أجرة السائق؟','عام: القاعدة الأساسية عند غياب قاعدة أخص مطابقة. فرع: استثناء خاص بطلبات الفرع المحدد.'],
   scopeId:['معرّف النطاق','يُضبط من اختيار النطاق أو الفرع. للنطاق العام يبقى GLOBAL.'],
   from:['بداية تطبيق الأجرة UTC','توقيت بدء القاعدة. UTC أقل من توقيت العراق بثلاث ساعات. عروض السائق المقبولة سابقًا تحتفظ بأجرتها المثبتة.'],
   to:['نهاية تطبيق الأجرة UTC — اختياري','فارغ يعني أن القاعدة مستمرة دون تاريخ انتهاء.'],
   id:['مرجع قاعدة الأجرة الداخلي','معرّف تقني؛ اتركه كما هو. لا يغيّر مبلغ الأجرة.'],
   version:['نسخة قاعدة الأجرة','١ للجديدة. تعديل قاعدة منشورة يحتاج نسخة أعلى لتوثيق التغيير.'],
   priority:['الأولوية داخل النطاق نفسه','لا تحدد مبلغ الأجرة. اتركها صفرًا لقاعدة عامة واحدة. نطاق الفرع يتقدم على العامة دون رفع هذا الرقم.'],
   fallback:['مرجع سياسة مسار تقديري — اختياري','اتركه فارغًا للاعتماد على مسارات فعلية. يلزم مرجع سياسة معتمدة للسماح بمسار تقديري.']
  };
  for(const [id,[title,description]]of Object.entries(fields)){
   const input=document.getElementById('rule-'+id);if(!input)continue;const label=input.parentElement;if(label.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent=title;
   const hint=document.createElement('small');hint.id='rule-'+id+'-help';hint.className='pricing-field-hint';hint.textContent=description;label.append(hint);input.setAttribute('aria-describedby',hint.id);
  }
  const banner=document.createElement('aside');banner.className='pricing-formula-help pricing-driver-help';banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');host.prepend(banner);
  const longGroup=document.getElementById('rule-longKm').closest('fieldset');longGroup.querySelector('legend').textContent='زيادة اختيارية فوق أجرة السائق للمسافات البعيدة';
  const peakGroup=document.getElementById('pricing-peak-rows').closest('fieldset');peakGroup.querySelector('[data-driver-peak-help]')?.remove();const note=document.createElement('p');note.dataset.driverPeakHelp='true';note.textContent='زيادة اختيارية فوق أجرة السائق خلال فترة بداية ونهاية محددتين بتوقيت UTC. لا تضف فترة إذا لا تريد زيادة ذروة.';note.className='pricing-field-hint';peakGroup.append(note);
  const n=id=>{const value=document.getElementById('rule-'+id).value;return value!==''&&Number.isFinite(Number(value))?Number(value):null;};
  function refresh(){
   const base=n('base'),pickup=n('pickupPerKm'),included=n('pickupIncludedMeters'),delivery=n('deliveryPerKm'),minute=n('perMinute'),after=n('longAfter'),flat=n('longFlat'),extra=n('longKm');
   banner.replaceChildren();const title=document.createElement('strong');title.textContent='كيف تتجمع أجرة السائق؟';banner.append(title);const text=document.createElement('p');text.textContent='المبلغ الثابت + تعويض الوصول للمطعم + تعويض التوصيل للزبون + تعويض وقت القيادة + الزيادات المفعّلة، ثم الحدود والتقريب. الإكرامية مستقلة.';banner.append(text);
   const arrival=document.createElement('p');arrival.textContent=pickup===0?'تعويض الوصول إلى المطعم معطّل؛ السائق لا يحصل على إضافة مسافة الوصول.':included===0?'تعويض الوصول مفعّل من أول متر؛ المسافة المشمولة صفر.':'تعويض الوصول يبدأ بعد أول '+fmt(included||0)+' متر، بمبلغ '+fmt(pickup||0)+' د.ع لكل كم إضافي.';banner.append(arrival);
   if([base,pickup,included,delivery,minute].every(v=>v!==null&&v>=0)){
    const pickupPart=Math.max(0,3000-included)/1000*pickup,deliveryPart=5*delivery,timePart=20*minute;const example=document.createElement('p');example.className='pricing-driver-example';example.textContent='مثال توضيحي بالقيم المعروضة: السائق يبعد ٣ كم عن المطعم، والزبون ٥ كم عن المطعم، ومجموع القيادة المحسوبة ٢٠ دقيقة. الثابت '+fmt(base)+' + الوصول '+fmt(pickupPart)+' + التوصيل '+fmt(deliveryPart)+' + الوقت '+fmt(timePart)+' = '+fmt(base+pickupPart+deliveryPart+timePart)+' د.ع. هذا مجموع المكونات الأساسية فقط قبل زيادات المسافة والذروة والحدود والتقريب والإكرامية، وليس عرض أجرة نهائيًا.';banner.append(example);
   }
   const active=(flat||0)>0||(extra||0)>0;if(active&&longGroup.parentElement.classList.contains('pricing-editor-advanced'))host.insertBefore(longGroup,host.querySelector('.pricing-editor-advanced'));
   if(active&&after===0){const warning=document.createElement('p');warning.className='pricing-field-warning';warning.textContent='زيادة المسافة البعيدة تبدأ من صفر متر، فتضاف فوق أجر التوصيل على كامل طريق المطعم إلى الزبون.';banner.append(warning);}
  }
  for(const id of ['base','pickupPerKm','pickupIncludedMeters','deliveryPerKm','perMinute','longAfter','longFlat','longKm'])document.getElementById('rule-'+id).addEventListener('input',refresh);refresh();
 }

 window.attachPricingFieldHelp=(host,kind)=>{
  if(kind==='driver'){attachDriverHelp(host);return;}if(kind!=='delivery')return;document.querySelector('[data-driver-peak-help]')?.remove();
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
