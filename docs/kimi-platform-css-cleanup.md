# خطة وتنفيذ توحيد التنسيقات — WizzCentral Platform

> تم إعداد هذا الملف بواسطة Kimi Code كـ wiki عملي للفريق. يحدد الوضع الحالي للتنسيقات، ما تم تنفيذه، والخطوات المتبقية، حتى يمكن لأي مطور (أو "Code X") متابعة العمل بنفس الاتجاه دون العودة إلى الأنظمة القديمة.

---

## 1. الهدف

الوصول إلى **نظام تنسيق واحد** للمنصة المركزية:
- نظيف، سريع، موحد.
- يتبع أحدث قواعد تصميم الويب (Material Design 3 + متغيرات CSS).
- يدعم RTL بشكل أولي.
- يقلل التكرار ويُزيل الأكواد الميتة.

---

## 2. النظام الموحد المستهدف

| الملف | الدور |
|-------|-------|
| `frontend/styles/material-3-design-system.css` | أساس التصميم: tokens، typography، components، utilities |
| `frontend/styles/app-shell.css` | هندسة الصدفة: sidebar، main-content، responsive drawer |
| `frontend/styles/admin-ui.css` | التخصيص الإداري (الشريط الجانبي، الأزرار، الجداول، النوافذ المنبثقة) |
| `frontend/styles/arabic-ui.css` | إصلاحات RTL للغة العربية |
| `frontend/styles/arabic-font.css` | خط Wizz Arabic |
| `frontend/styles/wizz-theme-config.js` | إدارة الألوان بالجافاسكربت |

> **ملاحظة:** `admin-ui.css` و `app-shell.css` يُحمّلان ديناميكيًا بواسطة `frontend/assets/js/navigation.js` عندما يُضاف `body.wizz-shell`.

---

## 3. ما تم تنفيذه

### 3.1 حذف الملفات الميتة (غير المستخدمة)

تم حذف الأنظمة والملفات التالية لأنها لا تُستورد في أي صفحة أو JS:

- `frontend/styles/styles.css` — تنسيقات صفحة تسجيل الدخول القديمة.
- `frontend/styles/design-system.css` — نظام `.btn`/`.card`/utilities قديم.
- `frontend/styles/wizz-design-system.css` — نظام `.wizz-*` لم تعد تستخدمه أي صفحة.
- `frontend/styles/platform-theme.css` — تنسيقات دعم/محادثة قديمة غير مستخدمة.
- `frontend/styles/live-chat-enhancements.css` — تنسيقات دردشة مكررة غير مستخدمة.
- `frontend/styles/promotions-workspace.css` — تنسيقات عروض قديمة غير مستخدمة.

**النتيجة:** إزالة ~4,100 سطر CSS ميت.

### 3.2 فصل تنسيقات الصفحات عن HTML

تم استخراج inline `<style>` blocks من الصفحات التالية إلى ملفات CSS خارجية:

- `frontend/pages/support.html` → `frontend/styles/support-workspace.css`
- `frontend/pages/finance.html` → `frontend/styles/finance-workflow.css`
- `frontend/pages/order-exceptions.html` → `frontend/styles/finance-workflow.css`

في كل صفحة:
- أُزيل الـ `<style>` block.
- استُبدلت inline `style="overflow:auto"` بـ `class="table-wrap"`.
- استُبدلت inline styles الأخرى بـ classes موحّدة (مثل `settlement-schedules-panel`).

> **تنبيه:** `frontend/dashboard.css` (الملف الشيم) والملف الأصلي `frontend/styles/dashboard.css` لا يزالان موجودين حاليًا. تم استبدال استخدامهما، لكن الملفات نفسها تحتاج مراجعة قبل الحذف النهائي.

---

## 4. المشاكل التي تم تشخيصها ولم تُحل بعد

### 4.1 تكرار داخل `material-3-design-system.css` (تم حله)

تم إزالة ~200 سطر تكرار، منها:
- تعريف `body` مكرر.
- تعريفات مكررة لـ `md-navigation-drawer`، `md-navigation-item`، `.sidebar-header`، `.logo`، `.user-profile`، `.logout-btn`.

**الحالة:** تم دمج الأقسام المكررة والاحتفاظ بالتعريف الأحدث/الأكمل.

### 4.2 inline styles كثيرة في HTML

يوجد 381 حالة inline `<style>` في 26 ملف HTML. أولوية الاستخراج:

| الصفحة | الحالة |
|--------|--------|
| `promotions.html` | 98 — لم يبدأ |
| `merchants.html` | 65 — لم يبدأ |
| `customers.html` | 44 — لم يبدأ |
| `orders-new.html` | 40 — لم يبدأ |
| `regions.html` | 22 — لم يبدأ |
| `orders.html` | 16 — لم يبدأ |
| `support.html` | تم حله |
| `finance.html` | تم حله |
| `order-exceptions.html` | تم حله |

**الإجراء المطلوب:** استخراج كل inline style block إلى ملف CSS خارجي باسم الصفحة (مثلاً `promotions-workspace.css`) ثم دمج المكونات المتكررة في النظام الموحد.

### 4.3 ملفات CSS متخصصة متعددة

| الملف | الصفحة/الاستخدام | الحالة |
|-------|-----------------|--------|
| `finance-workflow.css` | `finance.html`, `order-exceptions.html` | نشط — يحتاج دمج تدريجي |
| `company-accounts.css` | `financial-management.html` | نشط — يحتاج دمج |
| `merchants-table.css` | `merchants.html` | نشط — يحتاج دمج |
| `promotions-page.css` | `promotions.html` | نشط — يحتاج دمج |
| `home-slideshow.css` | `promotions.html` | نشط — يحتاج دمج |
| `campaign-form-clarity.css` | `promotions.html` | نشط — يحتاج دمج |
| `material-3-campaign.css` | `promotions.html` | نشط — يحتاج دمج |
| `dashboard.css` | لم يعد يُستخدم | يمكن حذفه بعد التأكد |
| `frontend/dashboard.css` | shim يستورد styles/dashboard.css | يمكن حذفه مع styles/dashboard.css |

**الإجراء المطلوب:**
1. استخراج inline styles من `promotions.html` إلى `promotions-workspace.css` واحد.
2. دمج `promotions-page.css` + `home-slideshow.css` + `campaign-form-clarity.css` + `material-3-campaign.css` في `promotions-workspace.css`.
3. نقل القواعد العامة (أزرار، نماذج، جداول) من `finance-workflow.css` و `company-accounts.css` و `merchants-table.css` إلى `admin-ui.css`.
4. حذف `styles/dashboard.css` و `frontend/dashboard.css` بعد التأكد من عدم استخدامهما.

### 4.4 JS styles

يوجد 63 حالة تعديل styles بالجافاسكربت في 5 ملفات:

- `frontend/js/support/LiveChatUI.js` (16)
- `frontend/js/core/ModalManager.js` (36)
- `frontend/js/support/LiveChatSocket.js` (4)
- `frontend/js/core/ThemeManager.js` (5)
- `frontend/js/regions-simple.js` (2)

**الإجراء المطلوب:** استبدال التعديلات المباشرة للـ style بإضافة/إزالة classes كلما أمكن.

---

## 5. الخطة المتبقية (مراحل)

### المرحلة A — تنظيف النظام الموحد
- [ ] إزالة التكرارات من `material-3-design-system.css`.
- [ ] التأكد من أن `app-shell.css` هو المصدر الوحيد لهندسة الصدفة.
- [ ] توحيد متغيرات `--md-sys-*` و `--wizz-*`.

### المرحلة B — استخراج inline styles
- [ ] `promotions.html` → `promotions-workspace.css`
- [ ] `merchants.html` → `merchants-workspace.css`
- [ ] `customers.html` → `customers-workspace.css`
- [ ] `orders-new.html` → `orders-new-workspace.css`
- [ ] `regions.html` → `regions-workspace.css`
- [ ] `orders.html` → `orders-workspace.css`
- [ ] `finance.html` → `finance-workspace.css` (مع دمج الملف الحالي)

### المرحلة C — دمج التنسيقات المتخصصة
- [ ] توحيد تنسيقات العروض في ملف واحد.
- [ ] دمج `finance-workflow.css` + `company-accounts.css` في النظام المالي الموحد.
- [ ] دمج `merchants-table.css` في `admin-ui.css`.
- [ ] حذف `dashboard.css` و `frontend/dashboard.css`.

### المرحلة D — تنظيف JS styles
- [ ] مراجعة `ModalManager.js` واستبدال style mutations بـ classes.
- [ ] مراجعة `LiveChatUI.js` و `LiveChatSocket.js`.
- [ ] مراجعة `ThemeManager.js` و `regions-simple.js`.

### المرحلة E — اختبار
- [ ] `npm run build` يمر بدون أخطاء.
- [ ] فحص الصفحات الرئيسية بصريًا: dashboard, orders, finance, merchants, promotions, support, regions.
- [ ] اختبار RTL والشريط الجانبي على الجوال.

---

## 6. قواعد العمل للمطورين

1. **لا تضف ملف CSS جديد** إذا كان يمكن استخدام `admin-ui.css` أو `material-3-design-system.css`.
2. **لا تضع `<style>` كبير في HTML.** استخرج إلى `styles/[page]-workspace.css`.
3. **لا تستخدم inline `style=`** للحالات الديناميكية؛ استخدم classes (`hidden`, `active`, `disabled`, ...).
4. **استخدم المتغيرات** `--md-sys-*` أو `--admin-*` بدلاً من الألوان الثابتة.
5. **لا تُعِد تعريف `body` أو `.sidebar` أو `.main-content`** في ملفات فرعية؛ هذه محجوزة لـ `app-shell.css`.
6. **احتفظ بـ `admin-ui.css` كطبقة تخصيص** فوق `material-3-design-system.css`، لا كبديل.

---

## 7. ملخص الأرقام

| المؤشر | قبل | بعد الخطوات المنفذة |
|--------|-----|---------------------|
| ملفات CSS في `frontend/styles` | 19 | 13 |
| إجمالي سطور CSS | ~10,400 | ~6,300 |
| inline style blocks في HTML | 381 | تم حل support.html |
| ملفات CSS ميتة | 6 | 0 |

---

## 8. جهات الاتصال والسياق

- المشروع: `whizzCentralPlatform-stg`
- المسار: `frontend/styles/`, `frontend/pages/`
- أداة البناء: `vite` (`npm run build`)
- نظام التصميم: Material Design 3 + تخصيص WizzCentral Admin
- اللغة/الاتجاه: العربية / RTL

---

*آخر تحديث: 2026-10-23*
