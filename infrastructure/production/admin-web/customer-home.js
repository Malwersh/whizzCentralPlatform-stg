'use strict';

const byId = id => document.getElementById(id);
const root = '/staff/home-layout';
const audiences = { all: 'الجميع', guest: 'الضيوف', signedIn: 'الحسابات المسجّلة' };
const sources = {
  region: 'مطاعم المنطقة', rating: 'الأعلى تقييمًا', new: 'الأحدث',
  curated: 'مطاعم تختارها', favorites: 'المفضلة', pastOrders: 'الطلبات السابقة', recent: 'شوهدت مؤخرًا',
};
const rankings = { default: 'افتراضي', manual: 'ترتيب الاختيار', rating: 'حسب التقييم', new: 'الأحدث', distance: 'الأقرب', orders: 'الطلبات المكتملة' };
const navKinds = { activity: 'نشاط', cuisine: 'نوع مطبخ', brand: 'علامة تجارية' };
const icons = { grid: 'شبكة', restaurant: 'مطعم', store: 'متجر', cafe: 'مقهى', grocery: 'أسواق', sweets: 'حلويات',
  pizza: 'بيتزا', chicken: 'دجاج', burger: 'برغر', breakfast: 'فطور', healthy: 'صحي', sandwich: 'ساندويتش' };
const filterNames = { offers: 'العروض', all: 'الكل', openNow: 'مفتوح الآن', menuPrice: 'سعر القائمة', rating: 'التقييم',
  fastDelivery: 'مدة التوصيل', freeDelivery: 'توصيل مجاني', deliveryFee: 'رسوم التوصيل', preparation: 'وقت التحضير', sort: 'الترتيب' };
const filterDefaults = { rating: 4, fastDelivery: 30, deliveryFee: 2000, preparation: 25 };
const errors = {
  UNAUTHORIZED: 'انتهت جلسة الإدارة. سجّل الدخول ثم افتح الصفحة مجددًا.',
  ADMIN_MFA_REQUIRED: 'فعّل التحقق الثنائي لحساب الإدارة ثم أعد المحاولة.',
  PERMISSION_REQUIRED: 'تتطلّب إدارة الرئيسية صلاحية العروض على جميع المناطق.',
  'Permission required.': 'حسابك لا يملك صلاحية إجراء هذا التغيير.',
  'Layout changed. Refresh first.': 'حُفظت نسخة أحدث. حدّث البيانات قبل إعادة تطبيق تغييراتك.',
  'Layout changed or access revoked. Refresh first.': 'تغيّرت النسخة أو الصلاحيات. حدّث البيانات قبل المتابعة.',
  'Select curated merchants.': 'اختر مطعمًا واحدًا على الأقل للقسم اليدوي.',
  'Unknown region.': 'إحدى المناطق المختارة لم تعد موجودة. حدّث القائمة.',
  'Unknown merchant.': 'أحد الفروع المختارة غير متاح. حدّث القائمة.',
  'Invalid schedule.': 'تأكّد أن وقت البداية يسبق وقت الانتهاء.',
  'Invalid search examples.': 'أدخل من مثال واحد إلى ثمانية أمثلة للبحث.',
  'Invalid greeting text.': 'راجع نصوص الترحيب. يمكن استخدام {name} في ترحيب المسجّلين فقط.',
  'Invalid greeting schedule.': 'تأكّد من فترة ظهور الترحيب.',
  'Invalid navigation schedule.': 'تأكّد من فترة ظهور الاختصار.',
  'Invalid navigation label or ID.': 'أدخل عنوانًا صالحًا لكل اختصار.',
  'Invalid navigation selector.': 'اختر نشاطًا أو تصنيفًا للاختصار.',
  'Invalid filter threshold.': 'راجع الحد العددي للفلاتر.',
  'Invalid menu price bands.': 'راجع حدود فئات الأسعار وعدد الأصناف.',
  'Home layout capacity exceeded.': 'بلغت المسودة الحد الأقصى لحجمها. قلّل عدد الاختيارات في الأقسام.',
};
let state, options, draft, dirty = false, busy = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label, action, { disabled = false, aria } = {}) {
  const node = element('button', label, 'home-secondary');
  node.type = 'button';
  node.disabled = disabled;
  if (aria) node.setAttribute('aria-label', aria);
  node.addEventListener('click', action);
  return node;
}
function field(label, control) {
  const wrapper = element('label', label);
  wrapper.append(control);
  return wrapper;
}
function input(label, value, update, attributes = {}, onChanged = changed) {
  const control = Object.assign(element('input'), { type: 'text', ...attributes });
  control.value = value ?? '';
  control.addEventListener('input', () => { update(control.value); onChanged(); });
  return field(label, control);
}
function check(label, value, update, onChanged = changed) {
  const row = element('label', undefined, 'home-check');
  const control = Object.assign(element('input'), { type: 'checkbox', checked: value });
  control.addEventListener('change', () => { update(control.checked); onChanged(); });
  row.append(control, element('span', label));
  return row;
}
function select(label, value, items, update, required = true, onChanged = changed) {
  const control = Object.assign(element('select'), { required });
  for (const [id, name] of Object.entries(items)) {
    control.add(new Option(name, id, false, id === value));
  }
  if (value != null && !Object.hasOwn(items, value)) {
    control.add(new Option('اختيار سابق غير متاح', value, false, true));
  }
  control.addEventListener('change', () => { update(control.value); onChanged(); });
  return field(label, control);
}
function matchesLabel(rows) {
  return Object.fromEntries(rows.map(({ id, label, name }) => [id, label ?? name]));
}
function picker(title, rows, selected, update, remaining, onChanged = changed) {
  const details = element('details', undefined, 'home-picker');
  const summary = element('summary');
  const list = element('div', undefined, 'home-picker-list');
  const search = Object.assign(element('input'), { type: 'search', placeholder: 'بحث' });
  function refreshLabel() { summary.textContent = title + (selected.length ? ' · ' + selected.length : ''); }
  function renderList() {
    const q = search.value.trim().toLocaleLowerCase('ar');
    list.replaceChildren();
    const present = new Set(rows.map(row => row.id));
    const choices = [...rows, ...selected.filter(id => !present.has(id)).map(id => ({ id, name: 'اختيار سابق غير متاح' }))];
    for (const row of choices) {
      const name = row.name || row.label;
      if (q && !name.toLocaleLowerCase('ar').includes(q)) continue;
      list.append(check(name, selected.includes(row.id), enabled => {
        if (enabled && selected.length === remaining) {
          notify('بلغت الحد الأقصى لعدد الاختيارات.', true);
          renderList();
          return;
        }
        selected = enabled ? [...selected, row.id] : selected.filter(id => id !== row.id);
        refreshLabel();
        update(selected);
      }, onChanged));
    }
    if (!list.children.length) list.append(element('p', 'لا توجد خيارات مطابقة.'));
  }
  search.addEventListener('input', renderList);
  refreshLabel();
  renderList();
  details.append(summary, field('ابحث في الخيارات', search), list);
  return details;
}
function dates(row) {
  const local = value => value ? new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0, 16) : '';
  return ['startAt', 'endAt'].map((key, index) => input(
    index ? 'الانتهاء · توقيت بغداد' : 'البداية · توقيت بغداد', local(row[key]),
    value => { row[key] = value ? new Date(value + '+03:00').toISOString() : null; }, { type: 'datetime-local' },
  ));
}
function grid(...controls) {
  const node = element('div', undefined, 'home-grid');
  node.append(...controls);
  return node;
}
function rowCard(row, index, list, redraw, kind) {
  const art = element('article', undefined, 'home-card');
  const heading = element('div', undefined, 'home-row-heading');
  const title = element('h3', row.title || row.label || kind);
  const actions = element('div', undefined, 'home-actions');
  function move(target) {
    [list[index], list[target]] = [list[target], list[index]];
    changed();
    redraw();
  }
  actions.append(
    button('أعلى', () => move(index - 1), { disabled: index === 0, aria: 'تحريك ' + kind + ' لأعلى' }),
    button('أسفل', () => move(index + 1), { disabled: index === list.length - 1, aria: 'تحريك ' + kind + ' لأسفل' }),
    button('إزالة', () => { list.splice(index, 1); changed(); redraw(); }, { aria: 'إزالة ' + kind }),
  );
  heading.append(title, actions);
  art.append(heading);
  return { art, title, actions };
}
function number(label, row, key, min, max, { required = false, step = 1 } = {}) {
  return input(label, row[key], value => { row[key] = value === '' ? null : Number(value); },
    { type: 'number', min, max, required, step, dir: 'ltr' });
}
function addSection() {
  draft.sections.push({
    id: crypto.randomUUID(), title: '', source: 'region', audience: 'all', enabled: true,
    regionIds: [], merchantIds: [], limit: 6, ranking: 'default', placement: 'afterSlideshow',
    windowDays: 30, layout: 'carousel', filters: { cuisineIds: [], brandIds: [], openNow: false },
  });
  changed();
  renderSections();
  byId('sections').lastElementChild.querySelector('input[type=text]').focus();
}
function renderSections() {
  const list = byId('sections');
  list.replaceChildren();
  if (!draft.sections.length) list.append(element('p', 'المسودة خالية من الأقسام المخصصة.'));
  draft.sections.forEach((row, index) => {
    const { art, title } = rowCard(row, index, draft.sections, renderSections, 'القسم');
    const rules = row.filters;
    const possible = { ...rankings };
    if (row.source !== 'curated') delete possible.manual;
    art.append(grid(
      input('اسم القسم', row.title, value => { row.title = value; title.textContent = value || 'القسم'; }, { required: true, maxLength: 80 }),
      select('المحتوى', row.source, sources, value => {
        row.source = value;
        row.merchantIds = [];
        row.ranking = { rating: 'rating', new: 'new', curated: 'manual' }[value] || 'default';
        if (['favorites', 'pastOrders'].includes(value)) row.audience = 'signedIn';
        renderSections();
      }),
      select('الجمهور', row.audience, audiences, value => { row.audience = value; }),
      select('طريقة العرض', row.layout, { carousel: 'شريط أفقي', compactList: 'قائمة مختصرة' }, value => { row.layout = value; }),
      number('عدد المطاعم', row, 'limit', 1, 12, { required: true }),
      check('إظهار القسم', row.enabled, value => { row.enabled = value; }),
    ));
    if (row.source === 'curated') art.append(picker(
      'الفروع المختارة', options.merchants, row.merchantIds, ids => { row.merchantIds = ids; }, 30,
    ));
    const more = element('details');
    more.append(element('summary', 'الترتيب والمناطق ووقت العرض'), grid(
      select('الموقع في الصفحة', row.placement, { beforeSlideshow: 'أعلى موضع البانرات', afterSlideshow: 'أسفل موضع البانرات' },
        value => { row.placement = value; }),
      select('ترتيب المطاعم داخل القسم', row.ranking, possible, value => { row.ranking = value; }),
      select('فترة حساب الطلبات المكتملة', String(row.windowDays), { 7: '٧ أيام', 30: '٣٠ يومًا' },
        value => { row.windowDays = Number(value); }),
      ...dates(row),
      picker('مناطق العرض', options.regions, row.regionIds, ids => { row.regionIds = ids; }, 40),
      picker('أنواع المطابخ', options.cuisines, rules.cuisineIds, ids => { rules.cuisineIds = ids; }, 20),
      picker('العلامات التجارية', options.brands, rules.brandIds, ids => { rules.brandIds = ids; }, 20),
      check('المطاعم ذات العروض المؤهلة فقط', rules.offersOnly, value => { rules.offersOnly = value; }),
      check('المطاعم المفتوحة فقط', rules.openNow, value => { rules.openNow = value; }),
      number('أقصى مسافة · كم', rules, 'maxDistanceKm', 0.1, 100, { step: 0.1 }),
      number('أدنى تقييم', rules, 'minimumRating', 1, 5, { step: 0.1 }),
    ));
    art.append(more);
    list.append(art);
  });
  byId('add-section').disabled = draft.sections.length >= 12;
}
const headerDefaults = { enabled: false, source: 'both', selection: null, backgroundColor: '#00296B',
  itemBackgroundColor: null, title: 'مزايا ويز', intervalSeconds: 6, subtitle: 'عروض وخصومات',
  scenes: [], startAt: null, endAt: null };
let headerOfferChoices;
let headerOfferRequest;
const headerMenus = new Map();
const headerMenuRequests = new Map();
const offerSourceLabels = { benefit: 'ميزة ويز', platform: 'حملة ويز', merchant: 'خصم مطعم' };
const headerAllows = (scope, source) => scope === 'both' ||
  (scope === 'merchant' ? source === 'merchant' : source !== 'merchant');

function headerOfferPicker(row) {
  const selected = row.selection ? row.selection.source + ':' + row.selection.id : '';
  const choices = { '': 'كل العروض المؤهلة' };
  for (const offer of headerOfferChoices ?? []) {
    if (headerAllows(row.source, offer.source)) {
      choices[offer.source + ':' + offer.id] = offerSourceLabels[offer.source] + ' · ' + offer.name;
    }
  }
  return grid(
    select('العرض', selected, choices, value => {
      const [source, id] = value.split(':');
      row.selection = id ? { source, id } : null;
    }, false),
    ...(headerOfferChoices ? [] : [button('تحميل العروض المتاحة', async () => {
      if (headerOfferRequest) return;
      headerOfferRequest = request('/options?headerOffers=1');
      try {
        headerOfferChoices = (await headerOfferRequest).offers;
        renderPromotionHeader();
      } catch (error) {
        notify(error.message, true);
      } finally {
        headerOfferRequest = null;
      }
    })]),
  );
}

function headerScenes(row) {
  const branches = [{ id: 'platform', name: 'مزايا وعروض ويز' }, ...options.merchants];
  const names = matchesLabel(branches);
  const next = branches.filter(branch => !row.scenes.some(scene => scene.id === branch.id));
  let id = '';
  const list = element('div', undefined, 'home-rows');
  row.scenes.forEach((scene, index) => {
    const card = element('div', undefined, 'home-card');
    const edit = action => { action(); changed(); renderPromotionHeader(); };
    const move = delta => edit(() => {
      const other = index + delta;
      [row.scenes[index], row.scenes[other]] = [row.scenes[other], row.scenes[index]];
    });
    card.append(
      element('strong', names[scene.id] ?? scene.id),
      grid(
        check('إظهار المشهد', scene.enabled, value => { scene.enabled = value; }),
        input('عنوان المشهد', scene.title, value => { scene.title = value; }, { maxLength: 80 }),
        input('النص الثانوي للمشهد', scene.subtitle, value => { scene.subtitle = value; }, { maxLength: 100 }),
      ),
    );
    if (scene.id !== 'platform') {
      card.append(select('صور المنتجات', scene.productMode, {
        discounted: 'المنتجات المخفّضة', menu: 'القائمة المنشورة', selected: 'اختيار يدوي',
      }, value => edit(() => { scene.productMode = value; })));
      if (scene.productMode === 'selected') {
        if (headerMenus.has(scene.id)) {
          card.append(picker('منتجات القائمة المنشورة', headerMenus.get(scene.id), scene.productIds,
            ids => { scene.productIds = ids; }, 6));
        } else {
          card.append(button('تحميل منتجات الفرع', async () => {
            if (headerMenuRequests.has(scene.id)) return;
            headerMenuRequests.set(scene.id, request('/options?headerBranch=' + encodeURIComponent(scene.id)));
            try {
              const { products } = await headerMenuRequests.get(scene.id);
              headerMenus.set(scene.id, products);
              renderPromotionHeader();
            } catch (error) {
              notify(error.message, true);
            } finally {
              headerMenuRequests.delete(scene.id);
            }
          }));
        }
      }
    }
    card.append(grid(
      button('تحريك لأعلى', () => move(-1), { disabled: index === 0 }),
      button('تحريك لأسفل', () => move(1), { disabled: index === row.scenes.length - 1 }),
      button('إزالة المشهد', () => edit(() => { row.scenes.splice(index, 1); })),
    ));
    list.append(card);
  });
  if (row.scenes.length < 20 && next.length) {
    const add = button('إضافة مشهد', () => {
      if (!id) return;
      row.scenes.push({ id, enabled: true, title: '', subtitle: '', productMode: 'discounted', productIds: [] });
      changed();
      renderPromotionHeader();
    }, { disabled: true });
    const branch = select('مشهد جديد', '', { '': 'اختر ويز أو فرعًا', ...matchesLabel(next) }, value => {
      id = value;
      add.disabled = !value;
    }, false);
    list.append(grid(branch, add));
  }
  return list;
}

let classifications;
let classificationBranch = '';
function renderClassifications() {
  const panel = byId('home-classifications');
  panel.replaceChildren();
  if (!classifications) {
    panel.append(button('تحميل التصنيفات', () => run(async () => {
      classifications = await request('/classifications');
      renderClassifications();
    })));
    return;
  }
  const catalog = classifications;
  const edit = catalog.canEdit && state.permissions.edit;
  for (const [key, name] of Object.entries({ cuisines: 'أنواع المطابخ', brands: 'العلامات التجارية' })) {
    const list = element('div', undefined, 'home-rows');
    for (const row of catalog[key]) {
      const fields = grid(input('المعرّف', row.id, value => { row.id = value.trim(); }, { readOnly: true },
        () => {}), input('الاسم', row.label, value => { row.label = value; }, { readOnly: !edit }, () => {}));
      if (edit) fields.append(button('حذف التصنيف', () => {
        catalog[key] = catalog[key].filter(entry => entry !== row);
        renderClassifications();
      }));
      list.append(fields);
    }
    panel.append(element('h3', name), list);
    if (edit) panel.append(button('إضافة تصنيف', () => {
      catalog[key].push({ id: crypto.randomUUID(), label: '' });
      renderClassifications();
    }));
  }
  panel.append(select('الفرع', classificationBranch, { '': 'اختر فرعًا', ...matchesLabel(options.merchants) }, value => {
    classificationBranch = value;
    renderClassifications();
  }, false, () => {}));
  if (classificationBranch) {
    const branch = classificationBranch;
    const profile = catalog.profiles[branch] ?? { cuisineIds: [], brandId: null };
    if (edit) panel.append(
      picker('أنواع المطابخ للفرع', catalog.cuisines, profile.cuisineIds, ids => {
        profile.cuisineIds = ids;
        catalog.profiles[branch] = profile;
      }, 12, () => {}),
      select('العلامة التجارية للفرع', profile.brandId ?? '', { '': 'بلا علامة', ...matchesLabel(catalog.brands) }, value => {
        profile.brandId = value || null;
        catalog.profiles[branch] = profile;
      }, false, () => {}),
    );
  }
  if (edit) panel.append(button('حفظ التصنيفات', () => run(async () => {
    const { version, cuisines, brands, profiles } = catalog;
    await request('/classifications', { baseVersion: version, cuisines, brands, profiles });
    classifications = await request('/classifications');
    options = { ...options, cuisines: classifications.cuisines, brands: classifications.brands };
    render();
  }, 'حُفظت التصنيفات.')));
}

function renderPromotionHeader() {
  const row = draft.promotionHeader;
  const sources = { both: 'عروض ويز والمطاعم', platform: 'عروض ويز', merchant: 'خصومات المطاعم' };
  byId('promotion-header').replaceChildren(
    check('إظهار الشريط عند توفر عروض مؤهلة', row.enabled, value => { row.enabled = value; }),
    grid(
      select('مصدر العروض', row.source, sources, value => {
        row.source = value;
        if (row.selection && !headerAllows(value, row.selection.source)) row.selection = null;
        renderPromotionHeader();
      }),
      input('العنوان', row.title, value => { row.title = value; }, { required: true, maxLength: 45 }),
      input('النص الثانوي', row.subtitle, value => { row.subtitle = value; }, { maxLength: 100 }),
      input('لون الخلفية', row.backgroundColor, value => { row.backgroundColor = value; }, { type: 'color' }),
      check('لون يدوي لخلفية العناصر', row.itemBackgroundColor !== null, value => {
        row.itemBackgroundColor = value ? row.backgroundColor : null;
        renderPromotionHeader();
      }),
      ...(row.itemBackgroundColor ? [input('لون خلفية العناصر', row.itemBackgroundColor,
        value => { row.itemBackgroundColor = value; }, { type: 'color' })] : []),
      number('مدة عرض كل عنصر · ثانية', row, 'intervalSeconds', 5, 15, { required: true }),
      ...dates(row),
    ),
    headerOfferPicker(row),
    element('h3', 'مشاهد الشريط'),
    headerScenes(row),
  );
}
function renderWelcome() {
  const row = draft.welcome;
  const hints = Object.assign(element('textarea'), { rows: 3, required: true, value: row.searchHints.join('\n') });
  hints.addEventListener('input', () => { row.searchHints = hints.value.split('\n').map(s => s.trim()).filter(Boolean); changed(); });
  byId('welcome').replaceChildren(
    check('إظهار الترحيب', row.enabled, value => { row.enabled = value; }),
    grid(
      input('ترحيب المسجّلين', row.signedIn, value => { row.signedIn = value; }, { required: true, maxLength: 100 }),
      input('ترحيب الضيوف', row.guest, value => { row.guest = value; }, { required: true, maxLength: 100 }),
      input('ترحيب عام', row.anonymous, value => { row.anonymous = value; }, { required: true, maxLength: 100 }),
    ),
    element('p', 'استخدم {name} في ترحيب المسجّلين لإظهار اسم الزبون.'),
    field('أمثلة البحث · مثال واحد في كل سطر', hints),
    grid(number('مدة عرض كل مثال · ثانية', row, 'intervalSeconds', 4, 15, { required: true }), ...dates(row)),
  );
}
function navTargets(kind) {
  return kind === 'activity' ? Object.fromEntries(state.activityTypes.map(row => [row.id, row.labelAr]))
    : matchesLabel(kind === 'cuisine' ? options.cuisines : options.brands);
}
function navigationImageField(row) {
  const upload = Object.assign(element('input'), { type: 'file', accept: 'image/jpeg,image/gif' });
  upload.addEventListener('change', () => {
    const file = upload.files[0];
    if (!file) return;
    run(async () => {
      if (!(['image/jpeg', 'image/gif'].includes(file.type))) throw new Error('اختر صورة JPEG أو GIF.');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('تعذّر قراءة الصورة.'));
        reader.readAsDataURL(file);
      });
      const {imageKey, imageUrl} = await request('/slides', {
        action: 'uploadNavigation', contentType: file.type, image: data.split(',')[1],
      }, 35000);
      Object.assign(row, {imageKey, imageUrl});
      changed();
      renderNavigation();
    });
  });
  const controls = [field('صورة الاختصار', upload)];
  if (row.imageUrl) controls.unshift(Object.assign(element('img'), {
    src: row.imageUrl, alt: row.label, width: 64, height: 64,
  }));
  if (row.imageKey) controls.push(button('إزالة الصورة', () => {
    Object.assign(row, {imageKey: null, imageUrl: null});
    changed();
    renderNavigation();
  }));
  return grid(...controls);
}
function renderNavigation() {
  const target = byId('navigation');
  const settings = draft.navigation;
  if (!settings) {
    target.replaceChildren(element('p', 'يعرض التطبيق اختصاراته الافتراضية.'), button('تخصيص الاختصارات', () => {
      draft.navigation = { enabled: true, activitiesEnabled: true, topicsEnabled: true,
        items: [{ id: 'all', kind: 'all', label: 'الكل', enabled: true, value: null, audience: 'all', icon: 'grid', regionIds: [] }] };
      changed();
      renderNavigation();
    }));
    return;
  }
  const list = element('div', undefined, 'home-rows');
  settings.items.forEach((row, i) => {
    const { art, title, actions } = rowCard(row, i, settings.items, renderNavigation, 'الاختصار');
    if (i < 2) actions.firstChild.disabled = true;
    if (row.kind === 'all') actions.replaceChildren();
    art.append(input('عنوان الاختصار', row.label, value => { row.label = value; title.textContent = value || 'الاختصار'; },
      { required: true, maxLength: 35 }));
    if (row.kind !== 'all') art.append(grid(
      select('النوع', row.kind, navKinds, value => {
        row.kind = value;
        row.value = '';
        row.parentActivities = [];
        renderNavigation();
      }),
      select('يفتح', row.value, { '': 'اختر', ...navTargets(row.kind) }, value => { row.value = value; }),
      select('الأيقونة', row.icon, icons, value => { row.icon = value; }),
      select('الجمهور', row.audience, audiences, value => { row.audience = value; }),
      check('إظهار الاختصار', row.enabled, value => { row.enabled = value; }),
      picker('مناطق العرض', options.regions, row.regionIds, ids => { row.regionIds = ids; }, 40),
      ...dates(row),
    ));
    art.append(navigationImageField(row));
    list.append(art);
  });
  target.replaceChildren(
    grid(
      check('إظهار الاختصارات', settings.enabled, value => { settings.enabled = value; }),
      check('إظهار الأنشطة', settings.activitiesEnabled, value => { settings.activitiesEnabled = value; }),
      check('إظهار التصنيفات', settings.topicsEnabled, value => { settings.topicsEnabled = value; }),
    ),
    list,
    button('إضافة اختصار', () => {
      settings.items.push({ id: crypto.randomUUID(), kind: 'activity', label: '', enabled: true, value: '',
        audience: 'all', regionIds: [], icon: 'restaurant', parentActivities: [] });
      changed();
      renderNavigation();
    }, { disabled: settings.items.length >= 20 }),
    button('استخدام اختصارات التطبيق', () => { draft.navigation = null; changed(); renderNavigation(); }),
  );
}
function renderFilters() {
  const target = byId('filters');
  const settings = draft.filters;
  const list = element('div', undefined, 'home-rows');
  const available = Object.entries(filterNames).filter(([kind]) => !settings.items.some(row => row.kind === kind));
  settings.items.forEach(row => {
    const index = settings.items.indexOf(row);
    const { art, title, actions } = rowCard(row, index, settings.items, renderFilters, 'الفلتر');
    if (index === 1) actions.firstChild.disabled = true;
    if (row.kind === 'all') actions.replaceChildren();
    art.append(grid(
      input('عنوان الفلتر', row.label, value => { row.label = value; title.textContent = value || 'الفلتر'; },
        { required: true, maxLength: 35 }),
      ...(row.kind === 'all' ? [] : [check('إظهار الفلتر', row.enabled, value => { row.enabled = value; })]),
      ...(Object.hasOwn(filterDefaults, row.kind) ? [number(
        row.kind === 'rating' ? 'الحد الأدنى' : row.kind === 'deliveryFee' ? 'الحد الأعلى · د.ع' : 'الحد الأعلى · دقيقة',
        row, 'value', row.kind === 'rating' ? 1 : row.kind === 'deliveryFee' ? 0 : 5,
        row.kind === 'rating' ? 5 : row.kind === 'deliveryFee' ? 100000 : 180,
        { required: true, step: row.kind === 'rating' ? 0.1 : 1 },
      )] : []),
    ));
    list.append(art);
  });
  let kind = available[0]?.[0];
  function addFilter() {
    settings.items.push({ id: kind, kind, label: filterNames[kind], enabled: true, value: filterDefaults[kind] ?? null });
    changed();
    renderFilters();
  }
  target.replaceChildren(
    check('إظهار شريط الفلاتر', settings.enabled, value => { settings.enabled = value; }),
    grid(
      number('اقتصادي حتى · د.ع', settings.priceBands, 'economyMaxIqd', 1000, 999999, { required: true }),
      number('متوسط حتى · د.ع', settings.priceBands, 'mediumMaxIqd', 1001, 1000000, { required: true }),
      number('الحد الأدنى لعدد أصناف العينة', settings.priceBands, 'minSamples', 3, 30, { required: true }),
    ),
    list,
    ...(kind ? [select('نوع الفلتر', kind, Object.fromEntries(available), value => { kind = value; }),
      button('إضافة الفلتر', addFilter)] : []),
  );
}

function notify(message, error = false) {
  const node = byId('notice');
  node.textContent = message;
  node.dataset.error = String(error);
}
function setControls() {
  if (!state) return;
  const { edit, publish } = state.permissions;
  byId('editable').disabled = !edit || busy;
  byId('save').hidden = !edit;
  byId('save').disabled = !dirty || busy;
  byId('publish-header').hidden = !publish;
  byId('publish-header').disabled = dirty || busy || !state.draftPromotionHeader;
  byId('publish').hidden = !publish;
  byId('publish').disabled = dirty || busy || !state.version;
  byId('refresh').disabled = busy;
}
function changed() { dirty = true; setControls(); }
const dateLabel = time => new Intl.DateTimeFormat('ar-IQ', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad',
}).format(new Date(time));
function render() {
  byId('workspace').hidden = false;
  const published = state.published;
  byId('publication-state').textContent = published ?
    'الإصدار المنشور ' + published.revision + ' · ' + dateLabel(published.publishedAt)
    : 'يستخدم التطبيق أقسامه الافتراضية حتى نشر أول إصدار.';
  const history = byId('history');
  history.replaceChildren();
  if (!state.history.length) history.append(element('p', 'لا توجد إصدارات سابقة.'));
  [...state.history].reverse().forEach(snapshot => {
    const row = element('div', undefined, 'home-card home-row-heading');
    row.append(element('strong', 'الإصدار ' + snapshot.revision), element('span', dateLabel(snapshot.publishedAt)));
    if (state.permissions.publish) row.append(button('مراجعة واستعادة', () => review(snapshot)));
    history.append(row);
  });
  renderSections();
  renderPromotionHeader();
  renderClassifications();
  renderWelcome();
  renderNavigation();
  renderFilters();
  setControls();
}
async function request(path = '', body, timeout = 15000) {
  await window.Auth.ensureSession();
  const token = window.Auth.getToken('accessToken');
  if (!token) throw new Error(errors.UNAUTHORIZED);
  const response = await fetch(root + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errors[data.error] || errors[response.status === 401 ? 'UNAUTHORIZED' : ''] ||
    (response.status === 400 ? 'راجع الحقول والخيارات المدخلة ثم حاول مجددًا.' : 'تعذّر إكمال العملية. حاول مجددًا.'));
  return data;
}
async function load() {
  const [next, choices] = await Promise.all([request(), request('/options')]);
  state = next;
  options = choices;
  draft = structuredClone({
    sections: state.draft,
    promotionHeader: state.draftPromotionHeader ?? state.published?.promotionHeader ?? headerDefaults,
    welcome: state.draftWelcome ?? state.defaultWelcome,
    navigation: state.draftNavigation ?? null,
    filters: state.draftFilters,
  });
  dirty = false;
  render();
}
async function run(work, success = '') {
  busy = true;
  setControls();
  try {
    await work();
    notify(success);
  } catch (error) {
    notify(error.code === 'SessionExpired' ? errors.UNAUTHORIZED : error.message, true);
  } finally {
    busy = false;
    setControls();
  }
}
function review(snapshot) {
  if (dirty || busy) {
    notify('احفظ التعديلات الحالية أولًا.', true);
    return;
  }
  const dialog = byId('review');
  const restoring = Boolean(snapshot);
  byId('review-heading').textContent = restoring ? 'استعادة الإصدار ' + snapshot.revision : 'نشر الرئيسية';
  const list = element('ul');
  for (const row of (snapshot?.sections ?? draft.sections).filter(row => row.enabled)) {
    list.append(element('li', row.title + ' · ' + audiences[row.audience]));
  }
  byId('review-content').replaceChildren(
    element('p', list.children.length ? 'الأقسام المفعّلة في هذا الإصدار' : 'سيظهر قسم جميع المطاعم دون أقسام مخصصة.'),
    list,
  );
  byId('confirm').textContent = restoring ? 'استعادة ونشر' : 'نشر الإصدار';
  dialog.returnValue = '';
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'confirm') return;
    run(async () => {
      await request(restoring ? '/rollback' : '/publish', {
        baseVersion: state.version, ...(restoring && { revision: snapshot.revision }),
      });
      await load();
    }, 'نُشر الإصدار على تطبيق الزبون.');
  }, { once: true });
  dialog.showModal();
}
byId('add-section').addEventListener('click', addSection);
byId('refresh').addEventListener('click', () => {
  if (!dirty || window.confirm('توجد تغييرات غير محفوظة. هل تريد تحديث الصفحة؟')) run(load);
});
byId('publish').addEventListener('click', () => review());
byId('publish-header').addEventListener('click', () => {
  if (!state.permissions.publish || dirty || busy || !window.confirm('نشر الشريط العلوي وحده؟')) return;
  run(async () => {
    await request('/promotion-header/publish', { baseVersion: state.version });
    await load();
  }, 'نُشر الشريط العلوي.');
});
byId('editor').addEventListener('invalid', event => {
  for (let detail = event.target.closest('details'); detail; detail = detail.parentElement.closest('details')) detail.open = true;
}, true);
byId('editor').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || !dirty || !state.permissions.edit) return;
  run(async () => {
    await request('/draft', { baseVersion: state.version, ...draft });
    await load();
  }, 'حُفظت المسودة. انشرها لتظهر في التطبيق.');
});
run(load);
