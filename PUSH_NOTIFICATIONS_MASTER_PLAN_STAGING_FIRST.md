# Push Notifications — خطة تنفيذ كاملة (Staging أولاً → ثم Dev)

## 0) ملاحظة أمنية (إجراء إلزامي)
مفاتيح APNs `.p8` وملف Firebase Admin SDK (service account JSON) تعتبر **أسرار**.
- لا تُلصق في المحادثات ولا تُرفع إلى git.
- أي مفاتيح تم تداولها خارج Secrets Manager تعامل معها كـ **مكشوفة** (Rotate).
- التخزين المعتمد: AWS Secrets Manager + صلاحيات أقل-امتياز.

---

## 1) الهدف (مثل التطبيقات الكبيرة: DoorDash/Talabat)
بناء نظام إشعارات Push قوي “مبني صح” يغطي كل السيناريوهات:
- iOS + Android
- Foreground / Background / Terminated
- إشعارات تشغيلية + تسويقية
- أصوات وقنوات (Android channels) وباج (iOS badge) حسب النوع
- تتبع + سجل + تنظيف Tokens + حماية من التكرار

والأهم: **المصدر المركزي للتحكم والإرسال هو CentralPlatform**.

---

## 2) مبدأ معماري أساسي: Central-first (ليس ترقيع داخل كل تطبيق)
### ماذا يعني “مركزي” عملياً؟
1) CentralPlatform هو “مركز”:
   - تخزين Device Tokens لكل التطبيقات
   - Catalogue لأنواع الإشعارات + Templates + إعداد الصوت/الأولوية
   - Sender واحد عبر Firebase Admin (FCM v1)
   - Logs + Metrics + Token hygiene
   - واجهة تحكم (Send/Test + Broadcast + Segments)
2) التطبيقات (User/Merchant/Driver):
   - فقط: استقبال + عرض (foreground) + Routing عند الضغط + تسجيل Token.
3) باكندات الأنظمة الأخرى:
   - لا تقوم بإرسال Push مباشرة (قدر الإمكان).
   - ترسل “Events” إلى CentralPlatform (موقّعة/محمية)، وCentralPlatform يقرر ويرسل.

**النتيجة:** كل قواعد الإشعارات في مكان واحد، ويمكن ضبطها بدون كسر منطق كل تطبيق.

---

## 3) معلومات Firebase/APNs (Staging) — مرجع (لا تُرفع)
Firebase Project:
- Project ID: `wizz-business-app`
- Project number: `1007878389815`

Android Apps:
- User: `com.wiz.userapp` (App ID `1:1007878389815:android:71594cebe2d22d9f187fb2`)
- Driver: `com.wiz.wizdriverapp` (App ID `1:1007878389815:android:a4e1d433047f0a68187fb2`)
- Merchant: `com.whizz.merchant` (ضمن `google-services.json`)

iOS (Driver provided):
- Bundle: `com.wiz.wizdriverapp` (App ID `1:1007878389815:ios:49e9dee33224d670187fb2`)
- Apple Team ID: `F6B9QH9W82`
- APNs Key ID: `WQKAAXTT8C`

ملاحظة:
- تم تأكيد أن التطبيقات تشترك في مشروع Firebase واحد، وأن Team/Key موحّدة (حسب آخر تأكيد).

---

## 4) تعريف “أنواع الإشعارات” (Notification Taxonomy)
### لماذا هذا مهم؟
التطبيقات الكبيرة لا ترسل “push” بشكل عشوائي. كل إشعار له:
- نوع (type)
- هدف (objective)
- أولوية (priority)
- قناة وصوت (channel/sound)
- قواعد استهداف (targeting)
- سلوك عند الضغط (routing)
- قيود تكرار/هدوء (rate limits/quiet hours)

### التصنيف النهائي المعتمد (سنُبنى عليه)
هذا يثبت فهمنا أن الإشعارات ليست “نوعين فقط” حتى لو كان عندنا نوعين رئيسيين عملياً.
نعتمد 4 فئات (مع أمثلة) لأن لكل فئة سياسات مختلفة (أولوية/صوت/حد تكرار/ساعات هدوء/سجل):
1) **Operational / Transactional (تشغيلي/تحديثات)**
  - أمثلة: عرض موجة للسائق، قبول/رفض، إلغاء، تغيير حالة طلب.
  - عادة High لبعض الأنواع (مثل عرض طلب).
2) **Marketing / Incentives (تسويقي/تشجيعي)**
  - أمثلة: حوافز، حملات تشجيع، رسائل نشاط منطقة.
  - عادة Normal + Rate limiting.
3) **System / Announcement (نظام/إعلانات)**
  - أمثلة: صيانة، تحديث إلزامي، سياسة.
  - عادة Normal، وقد تكون High عند الضرورة.
4) **Safety / Critical (حرج/سلامة)**
  - أمثلة: تنبيه أمني، إيقاف حساب، حالة طوارئ.
  - High جداً + قيود دقيقة لمنع الإساءة.

### تقسيم الأنواع (عام)
1) **Realtime/Operational**: لشيء حساس للوقت (مثل طلب جديد للسائق)
2) **Informational**: معلومات عامة (منطقة مشغولة، تنبيه نظام)
3) **Marketing/Incentives**: حملات/حوافز/مكافآت
4) **System/Safety**: صيانة، سياسة، أمن، إلخ

---

## 5) الأنواع الصحيحة للسائق (Driver) حسب منطق تطبيقنا
هذه هي الأنواع التي تعتمدون عليها فعلياً (وليست “قائمة عامة”):

### D1) `driver.new_order_available`
- متى: عندما يبدأ Wave System موجة جديدة لطلب (Wave 1 → Wave 5)
- الاستهداف (Confirmed): **ليس broadcast لكل السواق في المنطقة**.
  - الإرسال يتم فقط للسواق الذين اختارهم Wave System في تلك الموجة.
  - معايير “المؤهل” (مختصر): `status=available` + `isSearching=true` + اتصال WebSocket صالح + صلاحية منطقة (Priority) + معايير أداء/مسافة تختلف حسب رقم الموجة.
  - Wave 1: Priority 0 ومعايير صارمة.
  - Wave 2–3: تتوسع المعايير (Priority 0/1 ومسافة أكبر).
  - Wave 4: Final (إعادة إرسال/فرصة ثانية).
  - Wave 5: Emergency (تخفيف المعايير + بونص).
- شرطك الأساسي: إذا التطبيق بالخلفية يصل إشعار، وعند الضغط يفتح **شاشة البحث عن الطلبات/الرئيسية**
- أولوية: High
- صوت: قوي/مميز
- Routing:
  - `route = driver_home_search`
  - payload يحمل: `orderId` (إن توفر)، `offerId`، `waveNumber`، `isEmergencyWave`، و `bonusAmount/bonusPercent` حتى نعرض “طلب جديد متاح” بشكل صحيح.

ملاحظة تنفيذية مهمة (MVP): Push هو fallback.
- نرسل Push عندما لا يوجد `connectionId` للسائق أو عندما يفشل إرسال WebSocket.
- لمنع الإزعاج: لا نرسل Push للسائق المتصل بنجاح (إلا إذا طلبتم العكس لاحقاً).

### D2) `driver.region_busy` / `driver.region_hot`
- متى: عندما تكون منطقة/منطاق “مشغولة” أو “طلبات كثيرة”
- يرسل حتى لو السائق Offline أو التطبيق مغلق
- أولوية: Normal أو High (حسب قرار المنتج)
- Routing:
  - `route = driver_home_search`
  - payload: `regionId/zoneId`, `messageKey`

### D3) `driver.incentive`
- متى: حملة حوافز (مثال: 5000 دينار لكل 3 توصيلات)
- أولوية: Normal (غير مزعج)
- Routing:
  - `route = driver_home_search` (أو صفحة حوافز إذا موجودة لاحقاً)
  - payload: `campaignId`, `termsUrl` (اختياري)

### D4) `driver.system_announcement`
- متى: إعلان/سياسة/صيانة
- أولوية: Normal
- Routing:
  - `route = driver_home_search` (MVP)

ملاحظة: WebSocket يبقى للأحداث “داخل التطبيق عندما يكون متصل”، لكن Push هو الـ fallback عندما يكون بالخلفية/منقطع.

---

## 6) العقد الموحد للـ Payload (Contract)
### قاعدة ذهبية
لا نعتمد على “شكل” متغير. كل Push يجب أن يحمل Data payload ثابتاً.

الحد الأدنى المقترح (Data payload):
- `type` (مثل `driver.new_order_available`)
- `app` (`driver|user|merchant`)
- `env` (`staging|dev|prod`)
- `route` (مثل `driver_home_search`)
- `priority` (`high|normal`)
- `sound` (مثل `driver_new_order`)
- `ts` (ISO timestamp)
- `idempotencyKey` (مهم لمنع التكرار)
- `target` (مثال: `driverId` أو `regionId` أو `segmentId`)

وحقول إضافية حسب النوع:
- `regionId/zoneId`
- `campaignId`

---

## 7) سلوك التطبيق على iOS/Android (مثل التطبيقات الكبيرة)
### Foreground
- النظام قد لا يعرض بانر تلقائي (خصوصاً iOS).
- لذلك نعرض عبر `flutter_local_notifications` مع channel/sound مطابق.

### Background / Terminated
- نعتمد على FCM notification (display) + data payload (routing).
- عند الضغط:
  - `onMessageOpenedApp` + `getInitialMessage`
  - Router يفتح الشاشة المطلوبة.

### حالة مهمة: التطبيق مغلق + WebSocket غير متصل
- Push يجب أن يكون مستقل عن WebSocket.
- عند فتح التطبيق من الإشعار، التطبيق يعيد تهيئة الاتصال ويعرض الشاشة.

---

## 8) مركزة التسجيل والإرسال (CentralPlatform APIs)
### A) Token Registry (مركزي)
Endpoints (staging):
- `POST /push/tokens/register`
- `POST /push/tokens/unregister`

Payload:
- `token`
- `platform` (`ios|android`)
- `app` (`driver|user|merchant`)
- `env` (`staging`)
- `subjectId` (driverId/userId/merchantId)
- `deviceId` (اختياري)
- `appVersion` / `buildNumber` (اختياري)

### B) Send/Test (مركزي)
- `POST /push/send/test` (يدوي لاختبار جهاز/سائق)
- `POST /push/send/broadcast` (منطقة/segment)

### C) Events ingestion (مركزي)
- `POST /push/events`
ترسلها باكندات الأنظمة الأخرى أو الـ central نفسها.
يجب حماية هذا endpoint (HMAC أو IAM auth) لمنع أي طرف من إرسال إشعارات عشوائية.

---

## 9) تخزين البيانات (DynamoDB) — مقترح عملي
### جدول Tokens (مركزي لكل env)
`CentralPush_DeviceTokens_staging`
- PK: `subjectId` (مثل driverId)
- SK: `deviceId#platform` أو `tokenHash`
- Attributes: `token`, `platform`, `app`, `env`, `createdAt`, `updatedAt`, `disabledAt`, `lastSeenAt`

### جدول Catalogue/Templates
`CentralPush_Templates_staging`
- PK: `app#type`
- SK: `lang` (مثال `ar`, `en`)
- Attributes: `titleTemplate`, `bodyTemplate`, `sound`, `channelId`, `priority`

### جدول Logs
`CentralPush_SendLog_staging`
- PK: `date` (YYYY-MM-DD)
- SK: `idempotencyKey`
- Attributes: `type`, `targetsCount`, `successCount`, `failureCount`, `errorsSample`

---

## 10) ضمانات الجودة (Reliability) — مثل التطبيقات الكبيرة
1) **Idempotency**: لا نرسل نفس الإشعار مرتين لنفس الحدث.
2) **Retry policy**: إعادة محاولة محدودة على أخطاء الشبكة فقط.
3) **Rate limiting**: منع إزعاج السائق (خاصة marketing/broadcast).
4) **Token hygiene**: تعطيل tokens غير الصالحة.
5) **Observability**: logs/metrics واضحة (success/failure/token invalid).

---

## 11) خطة التنفيذ على مراحل (Staging أولاً)
### Phase 0 — Audit (1–2 أيام)
- تحديد ما هو موجود فعلاً في كل تطبيق (FCM init / local notifications / routing)
- تحديد ما هو موجود في CentralPlatform backend للإرسال

### Phase 1 — تثبيت Contract + Driver Types (1 يوم)
- تثبيت schema نهائي للـ payload
- تثبيت أنواع السائق D1–D4 + قنوات/أصوات

### Phase 2 — Token Registry مركزي (1–2 أيام)
- بناء endpoints + جدول tokens + صلاحيات IAM
- تعديل تطبيق السائق ليسجل token في CentralPlatform بعد login

### Phase 3 — Test Send من CentralPlatform (1–2 أيام)
- إرسال Test push للسائق
- التأكد أن الضغط يفتح `driver_home_search`
- التأكد من الصوت + channel

### Phase 4 — Broadcast (Regions/Hot Zones) (2–4 أيام)
- `driver.region_busy/driver.region_hot` targeting حسب regionId
- UI بسيطة في CentralPlatform لإرسال broadcast لمنطقة

### Phase 5 — Incentives (2–4 أيام)
- Templates + حملة + إرسال مجدول/يدوي

### Phase 6 — توسيع لباقي التطبيقات (User ثم Merchant)
- نفس الـ contract ونفس token registry
- نضيف أنواعهم تدريجياً

---

## 14) Progress Tracker (نعلّم عليه “مكتمل”)
ملاحظة: سنقوم أيضاً بتحديث قائمة المهام داخل VS Code (Todo) بالتوازي، لكن هذا القسم هو مرجع داخل الملف نفسه.

- [ ] Phase 0 — Audit
- [ ] Phase 1 — Contract + Driver Types
- [x] Phase 2 — Token Registry (backend code ready)
- [x] Phase 3 — Test Send (backend code ready)
- [ ] Phase 4 — Broadcast Regions (يدوي MVP)
- [ ] Phase 5 — Incentives MVP (بدون شاشة)
- [ ] Phase 6 — توسيع لباقي التطبيقات

---

## 12) النقل إلى Dev
بعد نجاح Staging:
- إنشاء secrets/tables/config للـ dev
- التأكد من عدم خلط tokens بين البيئات
- تكرار نفس مراحل الاختبار

---

## 13) ما سنثبته الآن قبل أول سطر كود
1) السائق: `driver.new_order_available` يستهدف **السواق المختارين في كل موجة** (Wave System)، وليس كل المنطقة.
2) إشعارات المناطق: **لم نبنِ منطق metrics بعد** → الـ MVP ستكون “يدوية من المنصة” إذا احتجناها.
3) الحوافز: **لا توجد شاشة حوافز حالياً** → الـ MVP يفتح الرئيسية فقط.

