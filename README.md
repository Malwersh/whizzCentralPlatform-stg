# WhizzCentralPlatform Staging Environment

نسخة staging نظيفة من المنصة المركزية لنظام Whizz - تدير جميع التطبيقات (Driver, User, Merchant)

## 📊 المعلومات الأساسية

- **الحجم:** 55 MB (source code only)
- **الحجم بعد npm install:** ~1.5-2 GB
- **تاريخ الإنشاء:** 29 ديسمبر 2024
- **الأصل:** 4.6 GB → 55 MB (تقليل 99%!)
- **الهدف:** بيئة staging معزولة بالكامل للاختبار الآمن

## 🗂️ البنية

```
whizzCentralPlatform-stg/
├── package.json              # Dependencies رئيسية
├── local-dev-server.js       # 96 KB - Development server (محدّث Dec 25!)
├── _redirects                # Amplify/Netlify routing
│
├── frontend/                 # 3 MB - Web UI
│   ├── *.js (101 files)      # Vite + Vanilla JS
│   ├── assets/
│   ├── pages/
│   ├── styles/
│   └── index.html
│
├── backend/
│   ├── src/                  # Core Platform Services
│   │   ├── handlers/ (17 Lambda functions)
│   │   │   ├── amazon-connect-chat.js
│   │   │   ├── amazon-connect-websocket.js
│   │   │   ├── merchant-integration.js
│   │   │   ├── chat-bridge.js
│   │   │   ├── order-status-trigger.js
│   │   │   └── websocket-*.js
│   │   ├── services/
│   │   │   ├── bedrock-agent-service.js (AI)
│   │   │   ├── driver-assignment-service.js
│   │   │   └── knowledge-base-loader.js
│   │   └── utils/
│   │       ├── auth.js
│   │       └── response.js
│   │
│   ├── order-service/        # ⚠️ CRITICAL SERVICE
│   │   ├── src/
│   │   │   ├── orderCancellationService.ts
│   │   │   ├── driverUnassignmentService.ts
│   │   │   ├── walletServiceClient.ts
│   │   │   ├── websocketNotifier.ts
│   │   │   ├── orderTimelineManager.ts
│   │   │   └── index.ts
│   │   ├── template.yaml     # SAM CloudFormation
│   │   ├── samconfig.toml
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── wallet-service/       # ⚠️ CRITICAL SERVICE
│   │   ├── src/
│   │   │   ├── holdService.ts        # Hold/Release funds
│   │   │   ├── topupService.ts       # Wallet topup
│   │   │   ├── settlementService.ts  # Order settlements
│   │   │   ├── cognitoTrigger.ts     # Auto wallet creation
│   │   │   ├── authorizer.py         # API authorization
│   │   │   ├── walletService.ts
│   │   │   └── index.ts
│   │   ├── template.yaml     # SAM CloudFormation
│   │   ├── samconfig.toml
│   │   ├── infrastructure/   # DynamoDB tables
│   │   ├── examples/
│   │   └── package.json
│   │
│   └── serverless*.yml       # 14 Serverless Framework configs
│       ├── serverless.yml
│       ├── serverless.websocket.yml
│       ├── serverless.orders.yml
│       ├── serverless.campaigns.yml
│       └── ... (10 more)
│
├── lambda/                   # Wave System + Region Engines
│   ├── WaveSystem_CreateDispatchJob/
│   ├── WaveSystem_StartWave/
│   ├── WaveSystem_HandleDriverAccept/  # محدّث Dec 28! ✅
│   ├── WaveSystem_HandleDriverReject/
│   ├── WaveSystem_HandleWaveTimeout/
│   ├── WaveSystem_UpdateDriverMetrics/
│   ├── NeighborDiscoveryEngine/
│   ├── RegionPropagationEngine/
│   ├── RegionResolver/
│   ├── RegionsAPI/
│   └── SpatialIndexBuilder/
│
├── regions-api/              # Regions Playground
│   ├── server.js
│   └── dynamodb-service.js
│
├── scripts/                  # Deployment Scripts
│   ├── deploy-regions-lambda.sh
│   ├── deploy-regions-tables.sh
│   ├── deploy-update-driver-metrics.sh
│   ├── setup-api-gateway-wave-accept.sh
│   ├── setup-wave-timeout-eventbridge.sh
│   └── create-waveoffers-table.sh
│
├── cloudformation/           # Infrastructure as Code
│   ├── regions-lambda-stack.yaml
│   ├── regions-new-tables-stack.yaml
│   └── regions-tables-stack.yaml
│
├── infrastructure/
│   └── wallet-system-dynamodb.yaml
│
├── data/
│   └── regions.json          # Iraq regions data
│
└── Config Files:
    ├── .env.bedrock          # AI Bedrock config
    ├── aws-connect-infrastructure.yaml
    └── push-notification-template.yaml
```

## ✨ مميزات المنصة المركزية

### Frontend Features (101 JS Files)

#### 🏢 Admin Dashboard
- User management (Drivers, Customers, Merchants)
- Order monitoring & tracking
- Real-time analytics
- System health monitoring
- RBAC (Role-Based Access Control)

#### 💬 Amazon Connect Integration
- Live chat support
- Agent management
- Queue management
- Chat history
- File attachments
- WebSocket real-time updates

#### 📊 Campaign Management
- Promotional campaigns
- Condition engine
- Usage tracking
- Analytics dashboard

#### 🗺️ Region Management
- Iraq regions (Baghdad, Najaf, etc.)
- Governorate hierarchy
- Spatial indexing
- Coverage analysis

#### 🤖 AI Assistant (Bedrock)
- Agent suggestions
- Knowledge base integration
- Natural language processing

### Backend Services

#### Core Platform (backend/src/)
**Amazon Connect Services:**
- `amazon-connect-chat.js` - Chat initiation & messaging
- `amazon-connect-enhanced.js` - Enhanced chat features
- `amazon-connect-websocket.js` - Real-time WebSocket

**Integration Services:**
- `merchant-integration.js` - Merchant backend bridge
- `chat-bridge.js` - Cross-platform chat
- `public-chat-bridge.js` - Public chat API

**Order Management:**
- `order-status-trigger.js` - Order state changes
- `order-stream-processor.js` - DynamoDB streams

**WebSocket Services:**
- `chat-websocket-handler.js`
- `driver-assignment-websocket.js`
- `enhanced-websocket-default.js`
- `websocket-chat.js`
- `websocket-connections.js`

**AI & Support:**
- `agent-suggestion-handler.js` - AI-powered suggestions
- `support-handler.js` - Customer support

#### Order Service (TypeScript + SAM)
**وظائف:**
- Order cancellation with wallet integration
- Driver unassignment
- Wallet hold release
- WebSocket notifications to all apps
- Order timeline management
- Integration with wallet-service

**API Endpoints:**
- POST `/orders/{orderId}/cancel` - Cancel order
- POST `/orders/{orderId}/unassign-driver` - Unassign driver
- GET `/orders/{orderId}/timeline` - Get order history

**Environment Variables:**
```yaml
WalletServiceUrl: https://<WALLET_API_ID>.execute-api.us-east-1.amazonaws.com/staging
ServiceCognitoClientId: <STAGING_SERVICE_COGNITO_CLIENT_ID>
ServiceCognitoClientSecret: <STAGING_SERVICE_COGNITO_CLIENT_SECRET>
```

#### Wallet Service (TypeScript + Python + SAM)
**وظائف:**
- Multi-entity wallet management (Driver, Merchant, Platform)
- Hold system for pending orders
- Topup service with payment gateway integration
- Settlement service for completed orders
- Automatic wallet creation via Cognito trigger
- Transaction ledger with audit trail

**API Endpoints:**
- POST `/wallets/create` - Create wallet
- GET `/wallets/{userId}` - Get wallet balance
- POST `/wallets/topup` - Add funds
- POST `/wallets/holds/create` - Create hold
- POST `/wallets/holds/{holdId}/capture` - Capture hold
- POST `/wallets/holds/{holdId}/release` - Release hold
- POST `/wallets/settle` - Settle order payment
- GET `/wallets/transactions` - Transaction history

**DynamoDB Tables:**
- `dev-Wallets` - Wallet balances
- `dev-LedgerEntries` - Transaction log
- `dev-Holds` - Pending holds

#### Wave System (11 Lambda Functions)
**نظام إرسال الطلبات للسائقين:**

**Core Functions:**
- `WaveSystem_CreateDispatchJob` - إنشاء dispatch job
- `WaveSystem_StartWave` - بدء موجة جديدة
- `WaveSystem_HandleDriverAccept` - معالجة قبول السائق ✅
- `WaveSystem_HandleDriverReject` - معالجة رفض السائق
- `WaveSystem_HandleWaveTimeout` - معالجة انتهاء الوقت
- `WaveSystem_UpdateDriverMetrics` - تحديث إحصائيات السائق

**Region Engines:**
- `NeighborDiscoveryEngine` - اكتشاف المناطق المجاورة
- `RegionPropagationEngine` - نشر الطلبات للمناطق
- `RegionResolver` - حل الصراعات بين المناطق
- `RegionsAPI` - API للمناطق
- `SpatialIndexBuilder` - بناء فهرس مكاني

**Integration:**
- يتصل بـ DynamoDB: `WizzDriverLiveState`, `WaveOffers`, `WizzDispatchJobs_dev`
- يُحدّث حالة السائق فوراً عند القبول/الرفض
- يُرسل إشعارات WebSocket للسائقين

## 🚀 التثبيت والتشغيل

### Prerequisites
```bash
# Node.js 18+
node --version

# AWS CLI configured
aws --version

# SAM CLI (for order-service & wallet-service)
sam --version

# Serverless Framework (for backend/src/)
serverless --version
```

### 1. Root Setup (Development Server)
```bash
cd whizzCentralPlatform-stg

# Install dependencies
npm install

# Copy .env file
cp .env.bedrock .env
# Edit .env with your AWS credentials

# Start local development server
npm run start
# or
npm run local

# Frontend will be available at: http://localhost:3000
```

### 2. Frontend Only
```bash
npm run start:frontend
# Uses Vite dev server
```

### 3. Backend Core (Serverless Framework)
```bash
cd backend

# Install dependencies
npm install

# Deploy WebSocket API
npm run deploy:ws

# Deploy Orders API
npm run deploy

# Local development
npm run dev
```

### 4. Order Service (SAM)
```bash
cd backend/order-service

# Install dependencies
npm install

# Build
sam build

# Deploy to staging
sam deploy --config-env staging

# Local testing
sam local start-api
```

### 5. Wallet Service (SAM)
```bash
cd backend/wallet-service

# Install dependencies
npm install

# Python dependencies (for authorizer)
pip install -r requirements.txt

# Build
sam build

# Deploy to staging
sam deploy --config-env staging

# Test wallet creation
./test-create-wallet.js

# Test topup workflow
./test-topup-workflow.sh
```

### 6. Wave System Lambda Functions
```bash
cd lambda/WaveSystem_StartWave

# Install dependencies
npm install

# Deploy using script
cd ../../
./lambda/deploy-all-wave-system.sh
```

### 7. Region Engines
```bash
# Deploy all region Lambda functions
cd scripts
./deploy-regions-lambda.sh

# Create DynamoDB tables
./deploy-regions-tables.sh
```

## 🔧 التكوين المطلوب

### AWS Resources Needed

#### Cognito User Pools
- **WhizzCentralPlatform-Staging** - Admin users
- **WizzServiceAccounts-Staging** - Service-to-service auth

#### API Gateways
- **wizzcentral-websocket-staging** - WebSocket API
- **wizzcentral-orders-staging** - REST API
- **wallet-service-staging** - Wallet REST API
- **order-service-staging** - Order REST API

#### Lambda Functions
- 17 handlers (backend/src/)
- Order service function
- Wallet service function
- 11 Wave System functions
- 5 Region engine functions
- **Total: ~34 Lambda functions**

#### DynamoDB Tables
**Core Tables:**
- `WizzOrders_staging`
- `WhizzDrivers_staging`
- `WizzUser_users_staging`
- `WhizzMerchants_Businesses_staging`

**Wallet Tables:**
- `staging-Wallets`
- `staging-LedgerEntries`
- `staging-Holds`

**Wave System Tables:**
- `WizzDispatchJobs_staging`
- `WaveOffers_staging`
- `WizzDriverLiveState_staging`

**Chat Tables:**
- `ChatSessions_staging`
- `ChatMessages_staging`
- `WebSocketConnections_staging`

**Campaign Tables:**
- `WizzCentral_Campaigns_staging`
- `WizzCentral_Campaign_Conditions_staging`

**Region Tables:**
- `WizzRegions_staging`
- `WizzRegionNeighbors_staging`

#### S3 Buckets
- `whizz-central-assets-staging`
- `whizz-chat-attachments-staging`

#### EventBridge Rules
- `wave-timeout-checker-staging` - Every 30 seconds

#### SNS Topics
- `order-events-staging`
- `wallet-events-staging`

### Environment Variables

**Root (.env):**
```bash
AWS_REGION=us-east-1
AWS_PROFILE=Wizz_staging

# Bedrock AI
AWS_BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-v2

# DynamoDB Tables
ORDERS_TABLE=WizzOrders_staging
DRIVERS_TABLE=WhizzDrivers_staging
USERS_TABLE=WizzUser_users_staging
```

**Order Service:**
```yaml
Environment: staging
WalletServiceUrl: https://[wallet-api-id].execute-api.us-east-1.amazonaws.com/staging
ServiceCognitoClientId: [staging-client-id]
```

**Wallet Service:**
```yaml
Environment: staging
WalletsTableName: staging-Wallets
LedgerTableName: staging-LedgerEntries
HoldsTableName: staging-Holds
```

## 📦 ما تم استبعاده

### ✅ Excluded (لن يؤثر على النشر)
- `node_modules/` (1.9 GB) - يُعاد تثبيته عبر npm install
- `dist/` folders - يُبنى عبر build commands
- `build/` (104 MB) - Vite build artifacts
- `*.md` files (353 file!) - Documentation
- `*.backup`, `*.bak*` - Backup files
- `*.zip` - Deployment packages
- `*.log` - Log files
- `temp-*/` directories
- `archived-legacy-regions/`
- `backups/`
- `lambdas/` (قديم - 18 MB)
- `flutter/` (36 KB - غير مستخدم)
- `google-maps-playground/`
- `mapbox-playground/`
- `knowledge-base/`

### ✅ Included (ضروري للنشر)
- Source code (frontend/, backend/, lambda/)
- Configuration files (package.json, template.yaml, serverless.yml)
- Infrastructure as Code (cloudformation/, infrastructure/)
- Deployment scripts (scripts/)
- Data files (data/regions.json)
- Development server (local-dev-server.js)

## 🔄 سير العمل

### Development → Staging
1. اختبار التغييرات في dev environment
2. نسخ التحديثات إلى whizzCentralPlatform-stg
3. Push إلى Git branch: `staging`
4. Deploy services:
   ```bash
   # Backend handlers
   cd backend && npm run deploy
   
   # Order service
   cd backend/order-service && sam deploy --config-env staging
   
   # Wallet service
   cd backend/wallet-service && sam deploy --config-env staging
   
   # Wave System
   ./lambda/deploy-all-wave-system.sh staging
   ```
5. اختبار شامل في staging

### Staging → Production
1. التحقق من جميع الميزات في staging
2. مراجعة الأكواد
3. Merge من `staging` إلى `main`
4. Deploy to production with `--config-env production`

## 📝 ملاحظات مهمة

### Architecture Patterns
**المنصة المركزية تستخدم 3 أنماط مختلفة:**

1. **Serverless Framework** (backend/src/)
   - 14 serverless.yml configs
   - WebSocket APIs
   - REST APIs
   - Deploy: `serverless deploy`

2. **AWS SAM** (order-service, wallet-service)
   - TypeScript Lambda functions
   - template.yaml CloudFormation
   - Deploy: `sam build && sam deploy`

3. **Standalone Lambda** (lambda/ directory)
   - Individual functions with own package.json
   - Deploy via shell scripts
   - Wave System + Region engines

### Service Communication
**order-service ↔ wallet-service:**
- order-service يستدعي wallet-service API
- Authentication via Cognito Service Pool
- JWT tokens for service-to-service auth

**Wave System ↔ Central Platform:**
- Wave System يقرأ/يكتب مباشرة إلى DynamoDB
- لا يوجد API layer بينهما
- Real-time updates via DynamoDB streams

### Critical Scripts

**Active Testing Scripts (في الجذر):**
- `check_driver_status.js` - فحص حالة السائق (محدّث Dec 26!)
- `setup_new_driver.js` - إنشاء سائق جديد (محدّث Dec 26!)
- `update-order-status.js` - تحديث حالة الطلب

**Deployment Scripts (scripts/):**
- `deploy-regions-lambda.sh` - Deploy region engines
- `deploy-update-driver-metrics.sh` - Deploy metrics function
- `setup-api-gateway-wave-accept.sh` - Configure API Gateway
- `setup-wave-timeout-eventbridge.sh` - Configure EventBridge

## 🎯 الخطوات التالية

1. ✅ إنشاء Cognito User Pools للـ staging
2. ✅ إنشاء DynamoDB tables مع environment='staging'
3. ✅ تحديث جميع environment variables
4. ✅ Deploy backend handlers: `cd backend && npm run deploy`
5. ✅ Deploy order-service: `cd backend/order-service && sam deploy --config-env staging`
6. ✅ Deploy wallet-service: `cd backend/wallet-service && sam deploy --config-env staging`
7. ✅ Deploy Wave System: `./lambda/deploy-all-wave-system.sh staging`
8. ✅ Deploy Region engines: `cd scripts && ./deploy-regions-lambda.sh`
9. ✅ Configure EventBridge for Wave timeout
10. ✅ اختبار النظام بالكامل

## 📞 الدعم

- الحجم الأصلي: 4.6 GB
- الحجم النظيف: 55 MB (source code only)
- نسبة التقليل: 99%!
- Frontend JS files: 101
- Backend handlers: 17
- Lambda functions: 11 (Wave System + Regions)
- Order service: TypeScript + SAM
- Wallet service: TypeScript + Python + SAM
- Serverless configs: 14 files

---

**ملاحظة:** هذا مجلد staging نظيف - الملفات الأصلية في `whizzCentralPlatform/` لم تُمَس!

**آخر تعديل:** 29 ديسمبر 2024
