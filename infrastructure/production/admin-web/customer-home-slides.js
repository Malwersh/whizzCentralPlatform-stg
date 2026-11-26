'use strict';

(() => {
  const tab = byId('slides-tab');
  const layoutTab = byId('layout-tab');
  const editor = byId('slide-editor');
  const confirm = byId('slide-confirm');
  const form = byId('slide-form');
  const labels = { all: 'الجميع', registered: 'الحسابات المسجّلة', guests: 'الضيوف' };
  Object.assign(errors, {
    SLIDES_VERSION_CONFLICT: 'تغيّرت الشرائح في نافذة أخرى. حدّث القائمة قبل المتابعة.',
    SLIDE_DRAFT_REQUIRED: 'احفظ مسودة قبل النشر.',
    SLIDE_PAUSE_REQUIRED: 'أوقف عرض الشريحة قبل أرشفتها.',
    SLIDE_SCHEDULE_ENDED: 'انتهت فترة العرض. حدّث الموعد في مسودة جديدة.',
    SLIDE_REGION_UNAVAILABLE: 'إحدى المناطق المختارة غير متاحة. حدّث القائمة.',
    SLIDE_DESTINATION_UNAVAILABLE: 'المطعم المختار غير متاح. اختر مطعمًا آخر.',
    SLIDE_IMAGE_INVALID: 'تعذر استخدام الصورة. ارفعها مرة أخرى.',
    SLIDE_IMAGE_SCOPE: 'ارفع الصورة من حسابك على المنصة.',
    SLIDES_CAPACITY: 'يمكن إدارة ٢٠ شريحة. أرشف شريحة قديمة لإضافة أخرى.',
    'End time must be after the start time.': 'اختر وقت انتهاء بعد بداية العرض.',
    'Upload an image first.': 'اختر صورة للشريحة.',
    'Invalid GIF image.': 'تعذر قراءة الصورة المتحركة. اختر ملف GIF صالحًا.',
    'Invalid GIF dimensions.': 'أبعاد الصورة المتحركة كبيرة جدًا.',
  });
  let collection, working, selectedFile, busy = false, editing = false, decision;

  function notice(id, text, error = false) {
    byId(id).textContent = text;
    byId(id).dataset.error = String(error);
  }
  function showTab(slides) {
    for (const [control, active] of [[tab, slides], [layoutTab, !slides]]) {
      control.setAttribute('aria-selected', active);
      control.tabIndex = active ? 0 : -1;
      byId(control.getAttribute('aria-controls')).hidden = !active;
    }
    byId('refresh').hidden = slides;
    const location = new URL(window.location.href);
    if (slides) location.searchParams.set('tab', 'slides');
    else location.searchParams.delete('tab');
    history.replaceState(null, '', location);
    if (slides && !collection && !busy) load();
  }
  for (const control of [layoutTab, tab]) {
    control.addEventListener('click', () => showTab(control === tab));
    control.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? layoutTab : event.key === 'End' ? tab : control === tab ? layoutTab : tab;
      next.focus();
      showTab(next === tab);
    });
  }

  const toLocal = value => new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 16);
  const fromLocal = value => new Date(value + '+03:00').toISOString();
  function status(row) {
    if (!row.published) return ['draft', 'مسودة'];
    if (row.paused) return ['paused', 'متوقفة'];
    const now = Date.now();
    if (Date.parse(row.published.endAt) <= now) return ['ended', 'انتهت'];
    if (Date.parse(row.published.startAt) > now) return ['scheduled', 'مجدولة'];
    return ['live', 'تُعرض الآن'];
  }
  function mediaPreview(slide) {
    const preview = element('div', undefined, 'slide-preview');
    preview.append(Object.assign(element('img'), { src: slide.imageUrl, alt: slide.title, loading: 'lazy' }));
    return preview;
  }
  function audienceLabel(slide) {
    const names = slide.regionIds.map(id => collection.options.regions.find(row => row.id === id)?.name || 'منطقة غير متاحة');
    return labels[slide.audience] + ' · ' + (names.length ? names.join('، ') : 'كل المناطق');
  }
  function destinationLabel(slide) {
    if (['campaign', 'discount'].includes(slide.action.type)) {
      const source = slide.action.type === 'discount' ? 'merchant' : 'platform';
      return collection.options.offers?.find(row => row.source === source && row.id === slide.action.id)?.name ||
        'عرض غير متاح';
    }
    return slide.action.type === 'merchant'
      ? collection.options.merchants.find(row => row.id === slide.action.id)?.name || 'مطعم غير متاح'
      : 'إعلان للعرض فقط';
  }
  function renderList() {
    const list = byId('slides-list');
    const { permissions, slides } = collection;
    byId('slides-add').hidden = !permissions.create;
    byId('slides-add').disabled = busy || slides.length >= 20;
    list.replaceChildren();
    if (!slides.length) {
      list.append(element('p', 'لا توجد شرائح. أضف صورة، وحدّد موعد العرض، ثم احفظ المسودة للمراجعة.'));
      return;
    }
    for (const row of slides) {
      const slide = row.published || row.draft;
      const [current, label] = status(row);
      const badge = element('span', label, 'slide-badge');
      badge.dataset.status = current;
      const item = element('article', undefined, 'home-card');
      const heading = element('div', undefined, 'home-row-heading');
      heading.append(element('h3', slide.title), badge);
      const actions = element('div', undefined, 'home-actions');
      if (permissions.edit) actions.append(button(row.draft ? 'تحرير المسودة' : 'تعديل', () => openEditor(row), { disabled: busy }));
      if (permissions.publish && (row.draft || current === 'paused' && Date.parse(slide.endAt) > Date.now())) {
        actions.append(button(row.draft ? 'مراجعة ونشر' : 'استئناف العرض', () => openReview(row, 'publish'), { disabled: busy }));
      }
      if (permissions.publish && ['scheduled', 'live'].includes(current)) {
        actions.append(button('إيقاف العرض', () => openReview(row, 'pause'), { disabled: busy }));
      }
      if (['draft', 'ended', 'paused'].includes(current) && permissions[row.published ? 'publish' : 'edit']) {
        actions.append(button('أرشفة', () => openReview(row, 'archive'), { disabled: busy }));
      }
      item.append(mediaPreview(slide), heading,
        element('p', audienceLabel(slide)),
        element('p', dateLabel(slide.startAt) + ' — ' + dateLabel(slide.endAt)),
        element('p', destinationLabel(slide) + ' · ترتيب العرض ' + slide.displayOrder),
      );
      if (row.published && row.draft) item.append(element('p', 'توجد مسودة جديدة بانتظار النشر.'));
      item.append(actions);
      list.append(item);
    }
  }
  async function load(message = '') {
    busy = true;
    byId('slides-reload').disabled = true;
    if (collection) renderList();
    notice('slides-notice', 'جارٍ تحميل الشرائح…');
    try {
      collection = await request('/slides');
      notice('slides-notice', message);
    } catch (error) {
      notice('slides-notice', error.code === 'SessionExpired' ? errors.UNAUTHORIZED : error.message, true);
    } finally {
      busy = false;
      byId('slides-reload').disabled = false;
      if (collection) renderList();
    }
  }
  function populateSelect(id, rows, value) {
    const select = byId(id);
    select.replaceChildren(...rows.map(row => new Option(row.name, row.id)));
    if (value && !rows.some(row => row.id === value)) select.add(new Option('اختيار سابق غير متاح', value));
    select.value = value || rows[0]?.id || '';
  }
  function previewImage(url) {
    const image = byId('slide-preview-image');
    if (url) image.src = url;
    else image.removeAttribute('src');
    image.hidden = !url;
    byId('slide-preview-empty').hidden = Boolean(url);
  }
  function pickRegions(regionIds) {
    const control = picker('المناطق المستهدفة · اتركها فارغة لكل المناطق', collection.options.regions, regionIds,
      ids => { working.regionIds = ids; }, 50, () => {});
    const pickerInput = control.querySelector('input[type=search]');
    pickerInput.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
    byId('slide-regions').replaceChildren(control);
  }
  function destinationChanged() {
    const select = byId('slide-merchant');
    const type = byId('slide-type').value;
    const linked = type !== 'announcement';
    byId('slide-merchant-label').hidden = !linked;
    byId('slide-target-label').textContent = type === 'merchant' ? 'المطعم' : 'العرض';
    select.required = linked;
    if (!linked) return;
    const choices = type === 'merchant' ? collection.options.merchants :
      (collection.options.offers ?? []).filter(row => row.source === (type === 'discount' ? 'merchant' : 'platform'));
    const selected = working.action.type === type ? working.action.id : '';
    populateSelect('slide-merchant', [{ id: '', name: 'اختر الوجهة' }, ...choices], selected);

  }
  function openEditor(row) {
    const source = row?.draft || row?.published;
    const now = new Date();
    const fallback = {
      id: crypto.randomUUID(), title: '', audience: 'all', regionIds: [], displayOrder: collection.slides.length + 1,
      startAt: now.toISOString(), endAt: new Date(now.getTime() + 7 * 24 * 3600000).toISOString(),
      action: { type: 'announcement' },
    };
    working = structuredClone(source || fallback);
    selectedFile = null;
    form.reset();
    byId('slide-editor-title').textContent = row ? 'تحرير الشريحة' : 'إضافة شريحة';
    byId('slide-name').value = working.title;
    byId('slide-audience').value = working.audience;
    byId('slide-order').value = working.displayOrder;
    byId('slide-start').value = toLocal(working.startAt);
    byId('slide-end').value = toLocal(working.endAt);
    const merchantIsRelevant = collection.options.merchants.length || working.action.type === 'merchant';
    populateSelect('slide-type', [{ id: 'announcement', name: 'عرض الإعلان' },
      ...(merchantIsRelevant ? [{ id: 'merchant', name: 'فتح صفحة المطعم' }] : []),
      { id: 'campaign', name: 'فتح حملة ويز' },
      { id: 'discount', name: 'فتح خصم مطعم' }], working.action.type);
    destinationChanged();
    pickRegions(working.regionIds);
    previewImage(working.imageUrl);
    notice('slide-editor-notice', '');
    editor.showModal();
  }

  function readFile(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
      reader.readAsDataURL(blob);
    });
  }
  async function prepareImage(file) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      throw new Error('اختر صورة JPG أو PNG أو WebP أو GIF.');
    }
    if (file.type === 'image/gif') {
      if (file.size > 3 * 1024 * 1024) throw new Error('الحد الأقصى للصورة المتحركة ٣ ميغابايت.');
      return readFile(file);
    }
    if (file.size > 12 * 1024 * 1024) throw new Error('الحد الأقصى لملف الصورة ١٢ ميغابايت.');
    const image = Object.assign(new Image(), { src: await readFile(file) });
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 40000000) throw new Error('أبعاد الصورة كبيرة جدًا.');
    const scale = Math.min(1, 1440 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.87, 0.73, 0.55, 0.4]) {
      const encoded = canvas.toDataURL('image/jpeg', quality);
      if (encoded.length < 800000) return encoded;
    }
    throw new Error('تعذر ضغط الصورة. اختر صورة أصغر.');
  }
  byId('slide-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    selectedFile = null;
    byId('slide-save').disabled = true;
    event.target.disabled = true;
    try {
      const prepared = await prepareImage(file);
      if (event.target.files[0] !== file || !editor.open) return;
      selectedFile = prepared;
      previewImage(prepared);
      notice('slide-editor-notice', '');
    } catch (error) {
      previewImage(working.imageUrl);
      notice('slide-editor-notice', error.message, true);
    } finally {
      event.target.disabled = false;
      byId('slide-save').disabled = false;
    }
  });
  function toggleEditor(value) {
    editing = value;
    byId('slide-save').disabled = value;
    byId('slide-close').disabled = value;
    byId('slide-file').disabled = value;
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (editing) return;
    const startAt = fromLocal(byId('slide-start').value);
    const endAt = fromLocal(byId('slide-end').value);
    if (endAt <= startAt) return notice('slide-editor-notice', 'اختر وقت انتهاء بعد بداية العرض.', true);
    if (!selectedFile && !working.imageKey) return notice('slide-editor-notice', 'اختر صورة للشريحة.', true);
    toggleEditor(true);
    notice('slide-editor-notice', 'جارٍ حفظ المسودة…');
    try {
      if (selectedFile) {
        const [header, image] = selectedFile.split(',');
        const asset = await request('/slides', { action: 'upload', image, contentType: header.slice(5).split(';')[0] }, 35000);
        working.imageKey = asset.imageKey;
        working.imageUrl = asset.imageUrl;
        selectedFile = null;
      }
      const type = byId('slide-type').value;
      const slide = {
        title: byId('slide-name').value,
        audience: byId('slide-audience').value, displayOrder: Number(byId('slide-order').value),
        startAt, endAt, regionIds: working.regionIds, imageKey: working.imageKey,
        action: { type, id: type === 'announcement' ? working.id : byId('slide-merchant').value },
      };
      await request('/slides', { action: 'save', id: working.id, baseVersion: collection.version, slide });
      editor.close();
      await load('حُفظت المسودة ويمكن مراجعتها ونشرها.');
    } catch (error) {
      notice('slide-editor-notice', error.message, true);
    } finally {
      toggleEditor(false);
    }
  });
  function openReview(row, action) {
    const slide = (action === 'publish' ? row.draft : null) || row.published || row.draft;
    const title = { publish: 'نشر الشريحة', pause: 'إيقاف العرض', archive: 'أرشفة الشريحة' }[action];
    byId('slide-confirm-title').textContent = title;
    byId('slide-confirm-content').replaceChildren(
      element('strong', slide.title),
      mediaPreview(slide),
      element('p', audienceLabel(slide) + ' · ' + destinationLabel(slide)),
      element('p', dateLabel(slide.startAt) + ' — ' + dateLabel(slide.endAt)),
    );
    byId('slide-confirm-submit').textContent = title;
    decision = { action, id: row.id, baseVersion: collection.version };
    confirm.returnValue = '';
    confirm.showModal();
  }
  confirm.addEventListener('close', async () => {
    if (confirm.returnValue !== 'confirm' || busy) return;
    busy = true;
    byId('slides-reload').disabled = true;
    renderList();
    try {
      await request('/slides', decision);
      const messages = { publish: 'نُشرت الشريحة وفق فترة العرض المحددة.', pause: 'توقف عرض الشريحة.', archive: 'أُرشفت الشريحة.' };
      await load(messages[decision.action]);
    } catch (error) {
      busy = false;
      byId('slides-reload').disabled = false;
      renderList();
      notice('slides-notice', error.message, true);
    }
  });
  byId('slides-add').addEventListener('click', () => openEditor());
  byId('slides-reload').addEventListener('click', () => load());
  byId('slide-close').addEventListener('click', () => editor.close());
  byId('slide-type').addEventListener('change', destinationChanged);
  editor.addEventListener('cancel', event => { if (editing) event.preventDefault(); });
  if (new URLSearchParams(window.location.search).get('tab') === 'slides') showTab(true);
})();
