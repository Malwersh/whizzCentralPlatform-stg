'use strict';

(() => {
  const get = id => document.getElementById(id);
  const byDate = new Intl.DateTimeFormat('ar-IQ', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Baghdad' });
  const amount = new Intl.NumberFormat('ar-IQ');
  const states = {
    created:'أُنشئ الطلب', pending:'بانتظار المطعم', confirmed:'أكّده المطعم',
    preparing:'قيد التحضير', ready:'جاهز للاستلام', ready_for_pickup:'جاهز للاستلام',
    searching:'جارٍ البحث عن سائق', assigned:'أُسند إلى سائق', accepted:'قبله السائق',
    heading_to_store:'السائق في طريقه إلى المطعم', arrived_at_store:'وصل السائق إلى المطعم',
    picked_up:'استلمه السائق', heading_to_customer:'السائق في طريقه إلى الزبون',
    arrived_at_customer:'وصل السائق إلى الزبون', out_for_delivery:'قيد التوصيل',
    no_driver_available:'لم يتوفر سائق', reassigning:'جارٍ إعادة الإسناد',
    delivered:'تم التسليم', completed:'مكتمل', cancelled:'ملغى', expired:'انتهت المهلة',
    rejected:'مرفوض', returning:'جارٍ الإرجاع', returned:'تم إرجاعه',
    PREPARING:'قيد التجهيز', READY:'جاهزة', SENT:'أُرسلت', EXPIRED:'انتهت المهلة',
  };
  const reviewReasons = {
    SEARCH_WINDOW_EXPIRED:'انتهت مهلة البحث عن سائق.',
    MAX_WAVES_REACHED:'اكتملت موجات البحث من دون قبول.',
    NORMAL_WAVES_EXHAUSTED:'اكتملت موجات البحث من دون قبول.',
    PREPARATION_DEADLINE:'انتهت مهلة تجهيز العروض.',
    PREPARATION_TIMEOUT:'انتهت مهلة تجهيز العروض.',
  };
  const assignmentErrors = {
    ORDER_ALREADY_HANDED_OVER:'سُلّم الطلب للسائق أو بدأ الإرجاع. تابع من قضايا الطلب.',
    ORDER_CASH_REVIEW_REQUIRED:'راجع النقد المحصّل قبل تغيير الإسناد.',
    ORDER_CANCELLATION_PENDING:'يوجد إلغاء مسجّل للطلب. افتح طلبات الإلغاء لمراجعته.',
    ORDER_ASSIGNMENT_NOT_ACTIVE:'لا يوجد إسناد نشط يمكن فكّه.',
    ORDER_ASSIGNMENT_NOT_ELIGIBLE:'الإسناد الحالي غير مؤهل لفكّه من هذه الصفحة.',
    COD_ASSIGNMENT_CONFLICT:'تغيّر الإسناد. حدّث الطلب وراجع حالته.',
    COD_ASSIGNMENT_UNAVAILABLE:'تعذّر تأكيد العملية. حدّث الحالة قبل محاولة أخرى.',
    DELIVERY_OPERATIONS_UNAVAILABLE:'إعدادات الإسناد غير متاحة حاليًا.',
    INVALID_ORDER_MANAGEMENT:'تحقق من سبب القرار وأكّد حالة الاستلام والتحصيل.',
  };
  const restartStates = {
    QUEUED:'سُجّل القرار. دورة البحث الجديدة بانتظار البدء.',
    STARTED:'بدأت دورة البحث الجديدة.',
    NEEDS_REVIEW:'تحتاج محاولة بدء الدورة السابقة إلى مراجعة.',
    STALE:'تغيّر الإسناد بعد تسجيل الدورة السابقة.',
    SUPPRESSED_DELETION:'توقّف البحث بسبب طلب حذف مرتبط بالنشاط.',
  };
  const restartErrors = {
    INVALID_RESTART_REQUEST:'أدخل سببًا واضحًا لبدء دورة البحث.',
    RESTART_SEARCH_NOT_EXHAUSTED:'هذا الإجراء متاح بعد استنفاد البحث الحالي.',
    RESTART_ORDER_NOT_ELIGIBLE:'لا تسمح حالة الطلب الحالية ببدء دورة جديدة.',
    RESTART_EVIDENCE_CHANGED:'تغيّرت حالة الطلب أو موجاته. حدّث التفاصيل وأعد الفحص.',
    RESTART_ALREADY_DECIDED:'سُجّل قرار لهذه الدورة. حدّث حالة البحث.',
    RESTART_RESERVATION_PENDING:'ينتظر الطلب مطابقة محاولة الإسناد أو ضمان السائق السابق.',
    SEARCH_REVIEW_PROOF_REQUIRED:'تعذّر التحقق من سبب انتهاء دورة البحث السابقة.',
    FINANCIAL_INITIAL_RETRY_PROOF_REQUIRED:'لا تزال بيانات دورة البحث السابقة بحاجة إلى مراجعة.',
    GOODS_ALREADY_HANDED_OVER:'سُلّم الطلب للسائق. راجع قضية الطلب.',
    BRANCH_UNAVAILABLE_FOR_SEARCH:'الفرع غير متاح الآن. راجع حالة الفرع قبل إعادة البحث.',
    PRIOR_FINANCIAL_INTEGRATION_PENDING:'بانتظار اكتمال تسجيل الإسناد السابق وتحرير الضمان.',
    RESPONSE_INTEGRATION_PENDING:'بانتظار معالجة ردود العروض السابقة.',
    PRIOR_OFFER_STILL_ACTIVE:'يوجد عرض سابق لم تنتهِ صلاحيته بعد.',
    PRIOR_RELEASE_INVENTORY_REQUIRED:'تعذّر مطابقة سجل محاولات الإسناد مع سجل تحرير الضمانات.',
    PRIOR_RELEASE_PROOF_REQUIRED:'بيانات تحرير ضمان سابق غير مكتملة. راجع الإسناد السابق.',
    PRIOR_RELEASE_OFFER_REQUIRED:'تعذّر مطابقة تحرير الضمان مع العرض الذي قبله السائق.',
    PRIOR_GUARANTEE_RELEASE_PROOF_REQUIRED:'تعذّر التحقق من تحرير ضمان السائق السابق.',
    PRIOR_ACCEPTANCE_NOT_RELEASED:'يوجد قبول سابق يحتاج إلى معالجة قبل بدء دورة جديدة.',
    PRIOR_ACCEPTANCE_REQUIRES_RECONCILIATION:'تحتاج محاولة قبول سابقة إلى مطابقة قبل البحث.',
    PRIOR_OFFER_PROOF_REQUIRED:'تعذّر التحقق من سجل أحد العروض السابقة.',
    UNEXPECTED_FINANCIAL_RECORDS:'توجد سجلات مالية مرتبطة بالطلب. راجع قضايا الطلب قبل إعادة البحث.',
    PRIOR_WAVE_REQUIRES_RECONCILIATION:'تحتاج إحدى الموجات السابقة إلى مراجعة.',
    RETRY_INVENTORY_REQUIRES_EXTENDED_REVIEW:'عدد المحاولات السابقة يتطلب مراجعة سجل الإسناد.',
    FULL_CASH_BUDGET_COMMITMENT_REQUIRED:'تعذّر التحقق من تمويل الطلب. راجع قضايا الطلب قبل إعادة البحث.',
    FINANCIAL_RETRY_INVENTORY_INCOMPLETE:'سجل العروض والمحاولات يحتاج إلى مراجعة قبل بدء دورة جديدة.',
    DISPATCH_RESTART_UNAVAILABLE:'تعذّر التحقق من إعادة البحث. حدّث حالة الطلب ثم أعد المحاولة.',
  };
  const errors = {
    UNAUTHORIZED:'انتهت جلسة الإدارة. سجّل الدخول مجددًا.',
    PERMISSION_REQUIRED:'حسابك لا يملك صلاحية عرض هذه البيانات.',
    ORDER_NOT_FOUND:'لم نجد طلبًا بهذا الرقم.',
    INVALID_ORDER_REFERENCE:'أدخل رقم الطلب كما يظهر للزبون.',
    AMBIGUOUS_ORDER:'ظهر أكثر من طلب بهذا الرقم.',
    INVALID_CURSOR:'حدّث قائمة الفرع قبل تحميل المزيد.',
    INCONSISTENT_ORDER:'تعذّرت مطابقة الطلب مع الفرع.',
  };
  const followupErrors = {
    FOLLOWUP_CHANGED:'تغيّرت حالة المتابعة. حدّث القائمة قبل الحفظ.',
    FOLLOWUP_OWNED_BY_OTHER:'يتولّى المتابعة حاليًا موظف آخر.',
    FOLLOWUP_CLAIM_REQUIRED:'تولّ المتابعة أولًا لتتمكن من حفظ الملاحظة.',
    REVIEW_ACTION_NOT_ALLOWED:'لم تعد الحالة متاحة للمتابعة. حدّث القائمة.',
    REVIEW_UNAVAILABLE:'لم تعد الحالة متاحة. حدّث القائمة.',
    INVALID_FOLLOWUP:'اكتب ملاحظة واضحة من خمسة أحرف على الأقل.',
    INVALID_FOLLOWUP_SETTINGS:'المراجعة بين دقيقة و٦٠ دقيقة، والتصعيد بعدها وحتى ٢٤٠ دقيقة.',
    VERSION_OR_STATE_CONFLICT:'تغيّرت الإعدادات. أعد فتحها للاطلاع على القيم الحالية.',
    FOLLOWUP_UNAVAILABLE:'تعذّر تحميل متابعة الإسناد. أعد المحاولة.',
  };
  let branchCursor = null;
  let orderCursor = null;
  let selectedBranch = '';
  let activeOrder = '';
  let orderEpoch = 0;
  let listEpoch = 0;
  const orderRows = new Map();

  function element(tag, body) {
    const node = document.createElement(tag);
    if (body != null) node.textContent = body;
    return node;
  }

  function date(value) {
    return value ? byDate.format(new Date(value)) : 'غير مسجل';
  }

  async function request(path, query = {}, body) {
    await window.Auth.ensureSession();
    const token = window.Auth.getToken('accessToken');
    if (!token) throw Error(errors.UNAUTHORIZED);
    const suffix = new URLSearchParams(query).toString();
    const response = await fetch(path + (suffix ? '?' + suffix : ''), {
      method:body?'POST':'GET',
      ...(body ? {body:JSON.stringify(body)} : {}),
      headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
      cache:'no-store', signal:AbortSignal.timeout(body?35000:18000),
    });
    const result = await response.json().catch(() => ({}));
    if (token !== window.Auth.getToken('accessToken')) throw Error('تغير حساب الإدارة. أعِد فتح الصفحة.');
    if (!response.ok) throw Object.assign(Error(errors[result.error] || assignmentErrors[result.error] ||
      restartErrors[result.error] || followupErrors[result.error] || 'تعذّر تحميل البيانات. أعد المحاولة.'),{status:response.status});
    return result;
  }

  async function loadBranches(append = false) {
    const more = get('more-branches');
    const selector = get('branch-selector');
    const status = get('branch-status');
    more.disabled = true;
    try {
      const data = await request('/staff/merchants/directory', append ? { cursor:branchCursor } : {});
      for (const branch of data.items) {
        if (!Array.from(selector.options).some(option => option.value === branch.businessId)) {
          selector.add(new Option(branch.name || 'فرع', branch.businessId));
        }
      }
      branchCursor = data.nextCursor;
      more.hidden = !branchCursor;
      selector.disabled = selector.options.length === 1;
      get('branch-submit').disabled = selector.disabled;
      status.textContent = selector.disabled && !branchCursor ? 'لا توجد فروع متاحة ضمن صلاحياتك.' : '';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      more.disabled = false;
    }
  }

  function listRow(item) {
    const li = element('li');
    const button = element('button');
    button.type = 'button';
    button.dataset.order = item.orderId;
    button.setAttribute('aria-current', String(activeOrder === item.orderId));
    button.append(element('bdi', item.orderNumber),
      element('span', [states[item.status] || 'حالة الطلب', date(item.createdAt)].join(' · ')));
    button.onclick = () => showOrder(item.orderId);
    li.append(button);
    return li;
  }

  async function loadOrders(append = false) {
    const branch = append ? selectedBranch : get('branch-selector').value;
    if (!branch) return;
    const run = ++listEpoch;
    if (selectedBranch && selectedBranch !== branch) {
      ++orderEpoch;
      activeOrder = '';
      get('order-status').textContent = '';
      get('order-detail').replaceChildren(element('h2', 'تفاصيل الطلب'), element('p', 'اختر طلبًا من الفرع أو ابحث برقمه.'));
    }
    selectedBranch = branch;
    const status = get('branch-status');
    const more = get('more-orders');
    const list = get('order-list');
    if (!append) {
      orderRows.clear();
      list.replaceChildren();
      more.hidden = true;
    }
    more.disabled = true;
    status.textContent = 'جارٍ تحميل الطلبات…';
    try {
      const data = await request('/staff/order-monitoring', { branch, ...(append ? { cursor:orderCursor } : {}) });
      if (run !== listEpoch) return;
      for (const item of data.items) {
        if (!orderRows.has(item.orderId)) {
          orderRows.set(item.orderId, item);
          list.append(listRow(item));
        }
      }
      orderCursor = data.nextCursor;
      more.hidden = !orderCursor;
      status.textContent = orderRows.size ? '' : orderCursor ? 'حمّل طلبات أقدم لعرض بقية النتائج.' : 'لا توجد طلبات لهذا الفرع.';
    } catch (error) {
      if (run === listEpoch) status.textContent = error.message;
    } finally {
      if (run === listEpoch) more.disabled = false;
    }
  }

  function section(title) {
    const node = element('section');
    node.append(element('h3', title));
    return node;
  }

  async function assignmentActions(item, workspace) {
    const load = element('button', 'فحص إمكانية فك الإسناد');
    load.type = 'button';
    load.className = 'monitor-secondary';
    const status = element('p');
    status.setAttribute('role','status');
    workspace.append(load,status);
    load.onclick = async () => {
      load.disabled = true;
      status.textContent = 'جارٍ فحص الإسناد…';
      try {
        const checked = await request('/staff/order-monitoring/assignment',{orderId:item.orderId});
        const action=checked.item;
        if (!action.canUnassign) {
          status.textContent=assignmentErrors[action.blocker] || errors.PERMISSION_REQUIRED;
          return;
        }
        load.hidden=true;
        status.textContent='';
        const form=element('form');
        form.className='monitor-assignment-form';
        const label=element('label','سبب فكّ الإسناد');
        const reason=element('textarea');
        reason.required=true;
        reason.rows=3;
        reason.minLength=5;
        reason.maxLength=500;
        label.append(reason);
        const confirmation=element('label','أؤكد أن السائق لم يتسلم الأصناف ولم يُحصّل أي مبلغ.');
        confirmation.className='monitor-confirmation';
        const check=element('input');
        check.type='checkbox';
        check.required=true;
        confirmation.prepend(check);
        const submit=element('button','فكّ الإسناد وإعادة البحث');
        const cancel=element('button','إغلاق');
        cancel.type='button';
        cancel.className='monitor-secondary';
        cancel.onclick=()=>{form.remove();load.hidden=false;status.textContent='';};
        const note=element('p',action.holdAmount>0
          ? 'سيُحرّر ضمان السائق البالغ '+amount.format(action.holdAmount)+' د.ع ويعود الطلب إلى البحث.'
          : 'سيعود الطلب إلى البحث حسب سياسة الإسناد الحالية.');
        form.append(note,label,confirmation,submit,cancel);
        workspace.append(form);
        reason.focus();
        let pending;
        form.onsubmit=async event=>{
          event.preventDefault();
          const text=reason.value.trim();
          if(text.length<5 || !check.checked) {
            status.textContent=assignmentErrors.INVALID_ORDER_MANAGEMENT;
            return;
          }
          if(!pending || pending.reason!==text)pending={reason:text,id:crypto.randomUUID()};
          submit.disabled=true;
          cancel.disabled=true;
          status.textContent='جارٍ تسجيل القرار…';
          try {
            const result=await request('/staff/order-monitoring/assignment',{},{
              orderId:item.orderId,offerId:action.offerId,attempt:action.attempt,
              reason:text,idempotencyKey:pending.id,confirmBeforePickup:true,
            });
            if(result.success!==true)throw Error(assignmentErrors.COD_ASSIGNMENT_UNAVAILABLE);
            if (workspace.isConnected) {
              await showOrder(item.orderId, 'فُكّ إسناد السائق وسُجّلت إعادة البحث حسب سياسة الإسناد الحالية.');
            }
          } catch(error) {
            status.textContent=error.message;
          } finally {
            submit.disabled=false;
            cancel.disabled=false;
          }
        };
      } catch (error) {
        status.textContent=error.message;
      } finally {
        load.disabled=false;
      }
    };
  }

  function restartActions(item, workspace, canAssign) {
    const reviewRequired=item.assignment.reviewRequired;
    const load=element('button', reviewRequired&&canAssign?'فحص إمكانية بدء دورة جديدة':'تحديث حالة البحث');
    load.type='button';
    load.className='monitor-secondary';
    const status=element('p');
    status.setAttribute('role','status');
    const path='/staff/order-monitoring/restart';
    workspace.append(load,status);
    load.onclick=async () => {
      load.disabled=true;
      status.textContent='جارٍ التحقق من موجات الطلب…';
      try {
        const {item:action}=await request(path,{orderId:item.orderId});
        if (!workspace.isConnected) return;
        status.textContent=[
          restartStates[action.state],
          reviewRequired&&!action.canRestart?(restartErrors[action.blocker]||assignmentErrors[action.blocker]||errors[action.blocker]):null,
        ].filter(Boolean).join(' ') || (action.canRestart?'':'لم تُسجّل دورة بحث جديدة لهذا الطلب.');
        if (!action.canRestart || !canAssign) return;
        load.hidden=true;
        const form=element('form');
        form.className='monitor-assignment-form';
        const label=element('label','سبب بدء دورة بحث جديدة');
        const reason=element('textarea');
        reason.required=true;
        reason.minLength=5;
        reason.maxLength=500;
        reason.rows=3;
        label.append(reason);
        const submit=element('button','بدء دورة بحث جديدة');
        const cancel=element('button','إغلاق');
        cancel.type='button';
        cancel.className='monitor-secondary';
        cancel.onclick=()=>{form.remove();load.hidden=false;load.focus();};
        form.append(element('p','يبدأ النظام الموجات وفق سياسة الإسناد السارية. يبقى سعر الطلب وتمويله كما هما.'),
          label,submit,cancel);
        workspace.append(form);
        reason.focus();
        let pending;
        form.onsubmit=async event=>{
          event.preventDefault();
          const text=reason.value.trim();
          if(text.length<5) {
            status.textContent=restartErrors.INVALID_RESTART_REQUEST;
            return;
          }
          if(!pending || pending.reason!==text)pending={reason:text,requestId:crypto.randomUUID()};
          submit.disabled=cancel.disabled=true;
          status.textContent='جارٍ تسجيل قرار إعادة البحث…';
          try {
            const result=await request(path,{},{
              orderId:item.orderId,caseId:action.caseId,baseDigest:action.baseDigest,...pending,
            });
            if (result.success!==true) throw Error(restartErrors.DISPATCH_RESTART_UNAVAILABLE);
            if (workspace.isConnected) await showOrder(item.orderId,'حُفظ قرار إعادة البحث.');
          } catch(error) {
            status.textContent=error.message;
          } finally {
            submit.disabled=cancel.disabled=false;
          }
        };
      } catch(error) {
        status.textContent=error.message;
      } finally {
        load.disabled=false;
      }
    };
    if (item.assignment.hasRestart&&!reviewRequired) queueMicrotask(()=>load.click());
  }

  function detail(item, permissions) {
    const root = get('order-detail');
    const facts = element('dl');
    facts.className = 'monitor-facts';
    for (const [key,value] of [
      ['المطعم أو الفرع', item.branchName || 'غير مسجل'],
      ['الحالة', states[item.status] || 'حالة غير معروفة'],
      ['السائق', item.assigned ? 'مسند إلى سائق' : 'لا يوجد سائق مسند'],
      ['تاريخ الطلب · بغداد', date(item.createdAt)],
      ['إجمالي الطلب', item.totalIqd != null ? amount.format(item.totalIqd) + ' د.ع' : 'غير مسجل'],
      ['طريقة الدفع', { cash:'نقدًا', cod:'نقدًا', CASH:'نقدًا', COD:'نقدًا', card:'بطاقة' }[item.paymentMethod] || 'غير مسجلة'],
    ]) {
      const block = element('div');
      block.append(element('dt', key), element('dd', value));
      facts.append(block);
    }

    const history = section('سجل الطلب');
    const events = element('ol');
    events.className = 'monitor-events';
    for (const event of item.timeline) {
      const line = element('li', states[event.event]);
      const when = element('time', date(event.at));
      when.dateTime = event.at;
      line.append(when);
      events.append(line);
    }
    history.append(item.timeline.length ? events : element('p', 'لا توجد مراحل مسجّلة.'));

    const dispatch = section('الإسناد والموجات');
    if (item.assignment) {
      const assignment = item.assignment;
      dispatch.append(element('p', states[assignment.status] || 'الحالة غير مسجلة'));
      if (assignment.reviewRequired) {
        dispatch.append(element('p', reviewReasons[assignment.reason] || 'هذه الحالة تحتاج إلى مراجعة الإسناد.'));
      }
      if (assignment.currentWave) dispatch.append(element('p', 'الموجة الحالية ' + amount.format(assignment.currentWave)));
      const waves = element('ol');
      waves.className = 'monitor-waves';
      for (const wave of assignment.waves) {
        const line = element('li', 'الموجة ' + amount.format(wave.number) + ' · ' + (states[wave.state] || 'الحالة غير مسجلة'));
        line.append(element('span', [
          wave.candidates != null ? 'السائقون المرشحون ' + amount.format(wave.candidates) : '',
          wave.deliveredOffers != null ? 'العروض المرسلة ' + amount.format(wave.deliveredOffers) : '',
          wave.createdAt ? date(wave.createdAt) : '',
        ].filter(Boolean).join(' · ')));
        waves.append(line);
      }
      if (assignment.waves.length) dispatch.append(waves);
      if (assignment.historyUnavailable) dispatch.append(element('p', 'بعض بيانات الموجات غير متاحة.'));
      if (assignment.earlierWavesOmitted) dispatch.append(element('p', 'تظهر آخر ٢٠ موجة في دورة البحث الحالية.'));
    } else {
      dispatch.append(element('p', 'لا يوجد إسناد مسجّل لهذا الطلب.'));
    }

    if (item.assigned && permissions?.assign) assignmentActions(item,dispatch);
    if (item.assignment?.hasRestart || item.assignment?.reviewRequired && permissions?.assign) {
      restartActions(item,dispatch,permissions?.assign===true);
    }

    const related = section('قضايا الطلب');
    const links = element('ul');
    links.className = 'monitor-links';
    const entries = [
      ['بلاغات الاستلام', 'pickup-issues', { orderId:item.orderId }],
      ['طلبات الإلغاء', 'order-cancellation', { order:item.orderNumber }],
      ['المرتجعات', 'order-returns', { orderId:item.orderId }],
      ['الشكاوى', 'order-complaints', { order:item.orderNumber }],
    ];
    if (permissions?.finance) entries.push(['مراجعة النقد', 'customer-cash-review', { orderId:item.orderId }]);
    for (const [title, slug, query] of entries) {
      const li = element('li');
      const link = element('a', title);
      link.href = '/pages/' + slug + '.html?' + new URLSearchParams(query);
      li.append(link);
      links.append(li);
    }
    related.append(links);

    const heading = element('h2', 'الطلب ');
    heading.append(element('bdi', item.orderNumber));
    root.replaceChildren(heading, facts, history, dispatch, related);
    root.focus({ preventScroll:true });
    root.scrollIntoView({ block:'nearest' });
  }

  async function showOrder(reference, feedback = '') {
    const run = ++orderEpoch;
    const message = get('order-status');
    message.textContent = 'جارٍ تحميل الطلب…';
    get('order-detail').replaceChildren(element('h2', 'تفاصيل الطلب'));
    try {
      const result = await request('/staff/order-monitoring/detail', { order:reference });
      if (run !== orderEpoch) return;
      activeOrder = result.item.orderId;
      for (const button of get('order-list').querySelectorAll('[data-order]')) {
        button.setAttribute('aria-current', String(activeOrder === button.dataset.order));
      }
      detail(result.item, result.permissions);
      message.textContent = feedback;
    } catch (error) {
      if (run === orderEpoch) message.textContent = [feedback,error.message].filter(Boolean).join(' ');
    }
  }

  function initializeDispatchFollowup() {
    const path='/staff/order-monitoring/followup';
    const refresh=get('followup-refresh'),more=get('followup-more'),status=get('followup-status');
    const list=get('followup-list'),policy=get('followup-policy');
    const cases=new Map();
    let cursor,loading=false;
    const actions={CLAIM:'تولّي المتابعة',NOTE:'حفظ الملاحظة',RELEASE:'تحرير المتابعة'};

    function card(item) {
      const f=item.followup;
      const record=element('li');
      record.className='monitor-followup-list-item';
      record.dataset.urgency=f.escalated?'escalated':f.overdue?'overdue':'current';
      const header=element('h3',item.branchName);
      const order=element('a');
      order.href='/pages/order-monitoring.html?'+new URLSearchParams({order:item.orderId})+'#order-detail';
      order.append('عرض الطلب ',element('bdi',item.orderNumber));
      const severity=f.escalated?'متصعّدة':f.overdue?'تجاوزت موعد المراجعة':'بانتظار المراجعة';
      const schedule=element('p','المراجعة '+date(f.reviewDueAt)+' · التصعيد '+date(f.escalationDueAt));
      schedule.className='monitor-followup-meta';
      record.append(header,order,element('p',severity+' · '+(f.ownerName||'بلا مسؤول متابعة')),schedule);
      if(f.restartState)record.append(element('p',f.restartState==='NEEDS_REVIEW'
        ?'تحتاج إعادة البحث إلى مراجعة.' : 'إعادة البحث بانتظار تأكيد بدء الموجات.'));
      if(f.lastNote)record.append(element('p',f.lastNote));

      const available=f.canRelease?['NOTE','RELEASE']:f.canClaim?['CLAIM']:[];
      if(!available.length)return record;
      const details=element('details');
      details.append(element('summary','إجراءات المتابعة'));
      const form=element('div');
      form.className='monitor-assignment-form';
      const label=element('label','ملاحظة المتابعة');
      const note=element('textarea');
      note.maxLength=1000;
      note.rows=2;
      label.append(note);
      const toolbar=element('div');
      toolbar.className='monitor-followup-actions';
      const feedback=element('p');
      feedback.setAttribute('role','status');
      let pending;
      for(const action of available){
        const button=element('button',actions[action]);
        button.type='button';
        toolbar.append(button);
        button.onclick=async()=>{
          const message=note.value.trim();
          if(message.length<5){feedback.textContent=followupErrors.INVALID_FOLLOWUP;return;}
          if(!pending||pending.action!==action||pending.note!==message)
            pending={action,note:message,requestId:crypto.randomUUID()};
          for(const control of toolbar.children)control.disabled=true;
          feedback.textContent='جارٍ حفظ المتابعة…';
          try{
            const result=await request(path,{},{
              orderId:item.orderId,caseId:item.caseId,baseVersion:f.version,...pending,
            });
            if(!result.saved)throw Error(followupErrors.FOLLOWUP_UNAVAILABLE);
            await load(false,'حُفظت المتابعة.');
          }catch(error){feedback.textContent=error.message;}
          finally{for(const control of toolbar.children)control.disabled=false;}
        };
      }
      form.append(label,toolbar,feedback);
      details.append(form);
      record.append(details);
      return record;
    }

    async function load(append=false,message='') {
      if(loading)return;
      loading=true;
      refresh.disabled=more.disabled=true;
      status.textContent='جارٍ تحميل حالات الإسناد…';
      try {
        const data=await request(path,append&&cursor?{cursor}:{});
        if(!append)cases.clear();
        for(const item of data.items)cases.set(item.caseId,item);
        cursor=data.nextCursor;
        more.hidden=!cursor;
        const priority=f=>f.escalated?2:f.overdue?1:0;
        const ordered=[...cases.values()].sort((a,b)=>
          priority(b.followup)-priority(a.followup)||
          a.followup.escalationDueAt.localeCompare(b.followup.escalationDueAt));
        list.replaceChildren(...ordered.map(card));
        status.textContent=message||(!ordered.length?(cursor?'يمكنك تحميل حالات أخرى.':'لا توجد حالات إسناد متعثرة حاليًا.'):'');
      }catch(error){status.textContent=error.message;}
      finally{loading=false;refresh.disabled=more.disabled=false;}
    }

    let policyState;
    const policyContent=get('followup-policy-content'),policyStatus=get('followup-policy-status');
    function renderPolicy(state) {
      policyState=state;
      policy.hidden=false;
      if(!state.canSave){
        policyContent.replaceChildren(element('p','المراجعة خلال '+amount.format(state.reviewMinutes)+
          ' دقيقة، والتصعيد خلال '+amount.format(state.escalationMinutes)+' دقيقة من بدء التعثر.'));
        return;
      }
      const form=element('form');
      form.className='monitor-assignment-form';
      function field(title,value,min,max){
        const label=element('label',title);
        const input=element('input');
        input.type='number';
        input.required=true;
        Object.assign(input,{value,min,max});
        label.append(input);
        form.append(label);
        return input;
      }
      const review=field('مهلة المراجعة بالدقائق',state.reviewMinutes,1,60);
      const escalation=field('مهلة التصعيد بالدقائق',state.escalationMinutes,2,240);
      const label=element('label','سبب تعديل المهل');
      const reason=element('textarea');
      reason.required=true;
      reason.minLength=5;
      reason.maxLength=300;
      reason.rows=2;
      label.append(reason);
      const save=element('button','حفظ المهل');
      form.append(label,element('p','تسري المهل الجديدة على الحالات التي تُفتح بعد الحفظ.'),save);
      policyContent.replaceChildren(form);
      let pending;
      form.onsubmit=async event=>{
        event.preventDefault();
        const values={reviewMinutes:Number(review.value),escalationMinutes:Number(escalation.value)};
        if(values.escalationMinutes<=values.reviewMinutes || reason.value.trim().length<5){
          policyStatus.textContent='حدّد مهلة تصعيد بعد مهلة المراجعة، واكتب سبب التعديل.';
          return;
        }
        const update={baseVersion:state.version,values,reason:reason.value.trim()};
        const fingerprint=JSON.stringify(update);
        if(pending?.fingerprint!==fingerprint)pending={fingerprint,id:crypto.randomUUID()};
        save.disabled=true;
        policyStatus.textContent='جارٍ الحفظ…';
        try {
          const saved=await request(path+'/policy',{},{...update,requestId:pending.id});
          renderPolicy(saved.policy);
          policyStatus.textContent='حُفظت المهل للحالات الجديدة.';
        }catch(error){
          policyStatus.textContent=error.message;
          if(error.status===409)policyState=null;
        }finally{save.disabled=false;}
      };
    }

    async function loadPolicy(){
      try { const {policy:state}=await request(path+'/policy');renderPolicy(state); }
      catch(error){if(error.status===403)policy.hidden=true;}
    }
    policy.ontoggle=()=>{if(policy.open&&!policyState)loadPolicy();};
    refresh.onclick=()=>load();
    more.onclick=()=>load(true);
    load();
    loadPolicy();
  }

  get('order-search').onsubmit = event => {
    event.preventDefault();
    const order = event.currentTarget.elements.order.value.trim();
    if (order) showOrder(order);
  };
  get('branch-search').onsubmit = event => { event.preventDefault(); loadOrders(); };
  get('more-branches').onclick = () => loadBranches(true);
  get('more-orders').onclick = () => loadOrders(true);
  if (!window.Auth.requireAuthentication()) return;
  const query = new URLSearchParams(location.search);
  const linkedBranch = query.get('branch');
  loadBranches().then(async () => {
    if (!/^[a-z0-9_-]{1,128}$/i.test(linkedBranch || '')) return;
    const selector = get('branch-selector');
    if (selector.value) return;
    try {
      if (!Array.from(selector.options).some(option => option.value === linkedBranch)) {
        const branch = await request('/staff/merchants/branch', { businessId: linkedBranch });
        selector.add(new Option(branch.name || 'فرع', linkedBranch));
      }
      if (selector.value) return;
      selector.value = linkedBranch;
      selector.disabled = false;
      get('branch-submit').disabled = false;
      await loadOrders();
    } catch (error) {
      get('branch-status').textContent = error.message;
    }
  });
  initializeDispatchFollowup();
  const order = query.get('order');
  if (order) {
    get('order-search').elements.order.value = order;
    showOrder(order);
  }
})();
