# خطة نشر Staging (Whizz) — Runbook تفصيلي

**التاريخ:** 2026-01-01

## 0) الهدف
نشر بيئة **Staging معزولة بالكامل** عن Dev لجميع منظومة Whizz:
- WizzUser (Customer App)
- WhizzDrivers (Driver App)
- WhizzMerchants (Merchant App)
- WhizzCentralPlatform (Central Admin + خدمات مشتركة)

**حساب/بروفايل النشر:** AWS SSO profile = `Wizz_stg_UserApp`

**مبدأ أساسي:** ممنوع وجود قيم Dev hardcoded داخل نسخ staging (profiles/URLs/table names/cognito IDs/secrets). القيم الحساسة تُمرَّر وقت النشر أو تُسحب من SSM Parameter Store.

---

## 1) قبل البدء (Prerequisites)

### 1.1 تسجيل الدخول إلى AWS SSO
```bash
aws sso login --profile Wizz_stg_UserApp
```

### 1.2 أدوات محلية
- Node.js (يفضل 18+ أو 20+ حسب المشاريع)
- AWS SAM CLI
- AWS CLI v2
- Flutter SDK + Xcode (iOS) / Android SDK (Android)

### 1.3 سياسة أسرار (Secrets)
- لا تُخزَّن Secrets داخل Git.
- استخدم AWS Systems Manager Parameter Store:
  - `String` للـ IDs والـ URLs
  - `SecureString` للأسرار وكلمات المرور

---

## 2) قائمة التعديلات المطلوبة قبل النشر (Must قبل أي Deploy)

> الهدف من هذه الخطوة: ضمان أن staging لن يقوم بنشر/ربط dev بالخطأ.

### 2.1 توحيد البروفايل
- تأكد أن جميع عمليات النشر تستخدم `--profile Wizz_stg_UserApp`.
- امنع وجود `Wizz_dev_UserApp` داخل أي ملفات إعدادات في staging.

### 2.2 إزالة أي Defaults تشير لـ Dev
ابحث داخل كل مشروع staging عن الكلمات التالية، واعتبر أي نتيجة **Blocker**:
- `Wizz_dev_UserApp`
- أي URL يحتوي مسار stage `.../dev` (مثال: `execute-api.../<stage>`)
- `Stage="dev"` أو `Environment="dev"`
- أسماء جداول تنتهي بـ `_dev` أو تبدأ بـ `dev-`
- أي `ClientSecret` أو `ServicePassword` داخل الملفات

أمر بحث مقترح (macOS):
```bash
rg -n "Wizz_dev_UserApp|/dev\\b|\\bdev\\b|_dev\\b|dev-|ClientSecret|ServicePassword" <project-folder>
```

### 2.3 تخزين القيم المطلوبة في SSM Parameter Store
**القيم المشتركة (مقترح أسماء SSM):**
- `/whizz/stg/wallet-service/url` (String)
- `/whizz/stg/order-service/url` (String)

**Order Service credentials (مقترح):**
- `/whizz/stg/order-service/service-client-id` (String)
- `/whizz/stg/order-service/service-client-secret` (SecureString)
- `/whizz/stg/order-service/service-username` (String)
- `/whizz/stg/order-service/service-password` (SecureString)

**Merchants Cognito (مقترح):**
- `/whizz/stg/merchants/cognito/user-pool-id` (String)
- `/whizz/stg/merchants/cognito/client-id` (String)

**Shared WebSocket (إن كان موحّدًا على مستوى النظام):**
- `/whizz/stg/shared/websocket/api-id` (String)
- `/whizz/stg/shared/websocket/url` (String)

> ملاحظة: يمكن تعديل أسماء الـ parameters بما يتناسب مع naming convention لديكم، المهم: فصل staging عن dev وعدم hardcode.

### 2.4 ضبط إعدادات النشر (SAM) لتكون Staging آمنة افتراضيًا
المطلوب:
- `samconfig.toml` في staging يجب أن يكون:
  - stack_name خاص بـ staging
  - profile = `Wizz_stg_UserApp`
  - parameter overrides تُشير لـ `staging` وليس dev
  - ويُفضّل وجود `[staging.deploy.parameters]`

---

## 3) ترتيب النشر (Order مهم)

### المرحلة A — خدمات مشتركة (Foundation)
1) **Wallet Service** (CentralPlatform)
2) **Order Service** (CentralPlatform) — يعتمد على Wallet Service + credentials
3) أي خدمات Regions/Wave system أو Lambdas مشتركة (حسب احتياج النظام)

### المرحلة B — Backends التطبيقات
4) **WizzUser Backend** (SAM)
5) **WhizzMerchants Backend** (SAM) — يحتاج Cognito + WebSocket staging
6) **WhizzDrivers Backend** (Lambda) — يحتاج Order Service URL + Tables + WebSocket

### المرحلة C — Frontends
7) Flutter builds (User/Drivers/Merchants)
8) CentralPlatform web frontend (إن كان يُنشر عبر hosting)

---

## 4) خطوات النشر التفصيلية (Backends)

> كل خطوة تحتوي: Build → Deploy → تسجيل Outputs/SSM → Smoke Test.

### 4.1 Wallet Service (whizzCentralPlatform-stg/backend/wallet-service)
1) Build:
```bash
cd whizzCentralPlatform-stg/backend/wallet-service
sam build
```
2) Deploy:
```bash
sam deploy --config-env staging --profile Wizz_stg_UserApp
```
3) بعد النجاح:
- استخرج API URL من Outputs (CloudFormation) وخزّنه في:
  - `/whizz/stg/wallet-service/url`

4) Smoke Test:
- نادِ endpoint:
  - `GET /health`

Rollback:
- إن كانت بيئة جديدة ويمكن حذفها:
```bash
sam delete --config-env staging --profile Wizz_stg_UserApp
```

---

### 4.2 Order Service (whizzCentralPlatform-stg/backend/order-service)
**متطلبات قبل deploy:**
- `/whizz/stg/wallet-service/url` موجود
- credentials موجودة في SSM

1) Build:
```bash
cd whizzCentralPlatform-stg/backend/order-service
sam build
```
2) Deploy:
```bash
sam deploy --config-env staging --profile Wizz_stg_UserApp
```
3) بعد النجاح:
- خزّن API URL في:
  - `/whizz/stg/order-service/url`

4) Smoke Test:
- `GET /health`

Rollback:
```bash
sam delete --config-env staging --profile Wizz_stg_UserApp
```

---

### 4.3 WizzUser Backend (wizzuser-stg/backend)
1) Install + Build:
```bash
cd wizzuser-stg/backend
npm install
sam build
```
2) Deploy:
```bash
sam deploy --config-env staging --profile Wizz_stg_UserApp
```
3) بعد النجاح:
- سجّل Outputs المهمة (API URL + Cognito IDs إن كانت Outputs موجودة).

4) Smoke Tests (مقترح):
- `GET /health`
- تجربة login/register إذا متاح.

Rollback:
```bash
sam delete --config-env staging --profile Wizz_stg_UserApp
```

---

### 4.4 WhizzMerchants Backend (whizzMerchants-stg/backend)
**متطلبات قبل deploy:**
- Cognito Merchants staging (UserPoolId + ClientId)
- Shared WebSocket staging (ApiId + Url) إن كان merchants يعتمد عليه

1) Build:
```bash
cd whizzMerchants-stg/backend
sam build
```
2) Deploy (تمرير القيم عبر overrides أو samconfig):
```bash
sam deploy --config-env staging --profile Wizz_stg_UserApp \
  --parameter-overrides \
    Stage=staging \
    CognitoUserPoolId="$(aws ssm get-parameter --name /whizz/stg/merchants/cognito/user-pool-id --query Parameter.Value --output text --profile Wizz_stg_UserApp)" \
    CognitoClientId="$(aws ssm get-parameter --name /whizz/stg/merchants/cognito/client-id --query Parameter.Value --output text --profile Wizz_stg_UserApp)" \
    SharedWebSocketApiId="$(aws ssm get-parameter --name /whizz/stg/shared/websocket/api-id --query Parameter.Value --output text --profile Wizz_stg_UserApp)" \
    SharedWebSocketUrl="$(aws ssm get-parameter --name /whizz/stg/shared/websocket/url --query Parameter.Value --output text --profile Wizz_stg_UserApp)"
```

3) Smoke Tests:
- Auth health endpoint إن وجد
- تسجيل دخول/تحديث حالة طلب

Rollback:
```bash
sam delete --config-env staging --profile Wizz_stg_UserApp
```

---

### 4.5 WhizzDrivers Backend (whizzDrivers-stg/backend)
**ملاحظة:** هذا backend لا يبدو SAM في staging؛ يعتمد على تحديث Lambda code مباشرة.

**متطلبات قبل deploy:**
- تحديد env vars بشكل صريح، أهمها:
  - `ORDER_SERVICE_URL` من `/whizz/stg/order-service/url`
  - أسماء جداول staging الصحيحة (بدون `_dev`)

**خطوات مقترحة (قد تختلف حسب طريقة packaging لديكم):**
1) تجهيز package:
```bash
cd whizzDrivers-stg/backend
npm install --omit=dev
zip -r deployment.zip . -x "*.git*" "node_modules/.cache/*"
```

2) تحديث Lambda code:
```bash
aws lambda update-function-code \
  --function-name driver-profile-api-staging \
  --zip-file fileb://deployment.zip \
  --profile Wizz_stg_UserApp
```

3) تحديث env vars (مثال عام — عدّل القيم حسب جداولكم الفعلية):
```bash
aws lambda update-function-configuration \
  --function-name driver-profile-api-staging \
  --environment "Variables={\
DRIVER_TABLE=WhizzDrivers_stg,\
DRIVER_LIVE_STATE_TABLE=WizzDriverLiveState_stg,\
ORDERS_TABLE=WizzOrders_stg,\
WEBSOCKET_CONNECTIONS_TABLE=WizzUser_websocket_connections_stg,\
REGIONS_TABLE=WizzCentral_RegionsDerived_stg,\
REGION_INDEX_TABLE=WizzCentral_RegionIndex_stg,\
ORDER_SERVICE_URL=$(aws ssm get-parameter --name /whizz/stg/order-service/url --query Parameter.Value --output text --profile Wizz_stg_UserApp)\
}" \
  --profile Wizz_stg_UserApp
```

4) Smoke Tests:
- Test event داخل Lambda للتأكد من عدم وجود `Missing required env vars`.
- اختبار endpoint عبر API Gateway إن كان مربوط.

Rollback:
- إعادة نشر zip نسخة سابقة أو rollback عبر Lambda version/alias (إن مستخدم).

---

## 5) نشر الـ Frontends (Flutter)

### 5.1 User App (wizzuser-stg/frontend)
```bash
cd wizzuser-stg/frontend
flutter clean
flutter pub get
flutter build apk --release
flutter build ios --release
```

### 5.2 Drivers App (whizzDrivers-stg/frontend)
```bash
cd whizzDrivers-stg/frontend
flutter clean
flutter pub get
flutter build apk --release
flutter build ios --release
```

### 5.3 Merchants App (whizzMerchants-stg/frontend)
```bash
cd whizzMerchants-stg/frontend
flutter clean
flutter pub get
flutter build apk --release
flutter build ios --release
```

**مهم:** قبل build تأكد أن ملفات configs داخل Flutter تشير إلى staging APIs/Cognito/WS.

---

## 6) Smoke Tests بعد النشر (مصفوفة مختصرة)

### 6.1 WizzUser
- Login/Register
- Browse businesses
- Create order
- WebSocket connect (إن موجود)

### 6.2 WhizzDrivers
- Login
- Fetch/Update driver state
- Accept/Reject order
- تأكد أن النداء يذهب لـ **Order Service staging**

### 6.3 WhizzMerchants
- Login
- Receive order notification
- Update order status

### 6.4 CentralPlatform
- Wallet health
- Order service health
- Hold/Release flows (على بيانات تجريبية)

---

## 7) خطة Rollback (إلزامي تجهيزها قبل أول نشر)
- لكل Stack (SAM):
  - CloudFormation rollback تلقائي عند الفشل
  - أو `sam delete` لبيئات جديدة
- لـ Lambda direct update:
  - استخدم versions/aliases إن ممكن
  - احتفظ بنسخة zip سابقة

---

## 8) Checklist نهائي قبل الضغط على Deploy
- [ ] `aws sso login --profile Wizz_stg_UserApp` ناجح
- [ ] لا يوجد أي نصوص dev في repos staging (بحث rg)
- [ ] لا يوجد secrets داخل الملفات
- [ ] SSM parameters جاهزة
- [ ] ترتيب النشر واضح ومُتّبع
- [ ] Smoke tests مكتوبة ومسؤوليات واضحة

---

## 9) ملاحظة تنفيذية
إذا رغبت، يمكننا إضافة ملف `STAGING_PARAMETERS.md` منفصل يحتوي جدول (اسم الـ SSM parameter → الوصف → من يملأه → متى) لتسهيل التنسيق بين الفريق.
