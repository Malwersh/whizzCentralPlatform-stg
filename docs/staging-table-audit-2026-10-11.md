# تدقيق جداول Staging — 2026-10-11

تمت قراءة الجداول والمفاتيح والفهارس وإعدادات Lambda دون نقل سجلات Dev.

- Dev: 031857856164، 79 جدولاً.
- Staging: 699561669180، 44 جدولاً.

## النتائج التشغيلية

- جداول المستخدم الأساسية العشرة موجودة: الحسابات والتسجيل المؤقت واستعادة كلمة المرور والعناوين والمفضلة والمحفظة والمعاملات واتصالات واشتراكات WebSocket.
- جداول السائق الأساسية موجودة: WhizzDrivers_staging، WizzDriverLiveState_staging، WizzDriverPerformanceMetrics_staging، OTP، WaveOffers_staging وWizzDispatchJobs_staging.
- جداول المحفظة المركزية الستة موجودة؛ لا يلزم نسخ محافظ السائق القديمة من Dev.
- جداول المطاعم الأساسية للأعمال والمنتجات والكتالوج والفئات والتخفيضات وساعات العمل والمناطق والأجهزة موجودة.
- WhizzMerchants_Users موجود في Dev ومفقود في Staging؛ التسجيل المنشور يحاول الكتابة إليه، وقراءة تفاصيل المالك تحاول استخدامه. فشل الكتابة يُلتقط، لذلك قد ينجح تسجيل العمل مع فقد سجل مالكه.
- WhizzMerchants_BusinessSettings مفقود في الحسابين؛ يستخدمه حذف العمل في مسار يتجاهل الفشل. لا دليل كاف على وجوب استنساخه أو أنه مصدر إعدادات POS الحالي.
- WhizzMerchants_PosLogs مفقود في الحسابين؛ يظهر في إعدادات عامة، ولم يُعثر على استدعاء فعلي له في كود وظائف المطعم المحلي.
- WhizzMerchants_TimeoutLogs مفقود في الحسابين، لكن خدمة الطلبات الفعلية تستخدم order-receiver-timeout-logs-staging الموجود. إعدادات عامة قديمة لا تعني حاجة إنشاء جدول إضافي.
- WebSocket المطاعم يشير إلى wizzgo-staging-merchant-endpoints المفقود؛ الجدول الصحيح الموجود order-receiver-merchant-endpoints-staging. هذا خطأ إعداد يحتاج إصلاحاً واختباراً منفصلاً.
- ثلاث وظائف قديمة للإسناد تشير إلى driver-assignment-drivers/offers/responses-staging غير الموجودة؛ تستخدم طبقة Lambda قديمة. يجب مراجعة الطبقة والمسارات قبل استبدالها بنظام Wave الحالي، دون إنشاء جداول إسناد موازية تلقائياً.
- صفحة عروض المنصة تعتمد على WizzCentral_Campaigns وConditions وUsage وAnalytics المفقودة؛ يلزم نشر خدمة الحملات وربطها وصلاحياتها إن كانت الميزة مطلوبة. إنشاء الجداول وحده غير كافٍ.
- خدمات نقاط العملاء المحلية تشير إلى جداول Dev، وواجهة النقاط تطلب مسارات من أصل Amplify بدلاً من API منشور. جداول النقاط مفقودة في Staging، والميزة تحتاج تكاملاً مستقلاً.
- بيانات المناطق الأساسية والمشتقة والفهرس والجوار والتدقيق موجودة. خدمة إدارة المناطق ومحركات التوريث ليست منشورة في جرد Lambda الحالي؛ القراءة أصبحت تعتمد على الجداول، والتعديلات مقفلة إلى حين استكمال الخدمة.

## فروقات الفهارس (لا تعني تلقائياً وجوب نسخها)

| جدول Staging | فهارس توجد في Dev ولا توجد في Staging |
|---|---|
| WhizzMerchants_Businesses | ownerId-index |
| WizzCentral_Regions | GovernorateIndex, LevelIndex, ParentIndex |
| WizzDispatchJobs_staging | StatusCreatedIndex |
| WizzUser_websocket_connections_staging | ConnectionIdIndex, GSI1 |

محركات المناطق المحلية القديمة تستخدم ParentIndex مع parentRegionId، بينما الشكل الحالي يستخدم parent_id وفهرس parent-level-index؛ إضافة الفهرس القديم وحدها لا تعالج اختلاف بنية السجل.

## أسماء Dev بلا مقابل مباشر في Staging

تطبيع الأسماء يستبدل dev/staging فقط؛ بعض الجداول التالية لها بدائل بأسماء مختلفة أو أصبحت قديمة.
- `ChatMessages`
- `ChatSessions`
- `WaveOffers`
- `WebSocketConnections`
- `WhizzDrivers_assignments_dev`
- `WhizzDrivers_connections_dev`
- `WhizzDrivers_drivers_dev`
- `WhizzDrivers_payment_gateway_logs_dev`
- `WhizzDrivers_payment_methods_dev`
- `WhizzDrivers_wallet_transactions_dev`
- `WhizzDrivers_wallets_dev`
- `WhizzMerchants_Users`
- `WizzAggregatedMetrics`
- `WizzCentral_Campaign_Analytics`
- `WizzCentral_Campaign_Conditions`
- `WizzCentral_Campaign_Usage`
- `WizzCentral_Campaigns`
- `WizzCentral_Commission_Rules`
- `WizzCentral_Delivery_Fee_Rules`
- `WizzCentral_Financial_Audit`
- `WizzCentral_Financial_Transactions`
- `WizzCentral_Promotions`
- `WizzCentral_chat_sessions_dev`
- `WizzDispatchOfferTracking`
- `WizzDriverLiveState`
- `WizzDriverPerformanceMetrics`
- `WizzDriverScheduledActions_dev`
- `WizzDriverWorkSessions`
- `WizzFeatureFlags`
- `WizzGeographicRegions`
- `WizzOrderAssignments`
- `WizzOrderTimingMetrics`
- `WizzUser_customer_points_dev`
- `WizzUser_driver_assignments_dev`
- `WizzUser_offers_dev`
- `WizzUser_points_transactions_dev`
- `chat-messages-ghayth`
- `chat-sessions-ghayth`
- `dev-Wallets-backup-20251223`
- `dev-Wallets-backup-20251224-165741`
- `dev-Wallets-recovered-before-delete`
- `websocket-connections-ghayth`
- `whizz-drivers-verification-codes`

## حدود التنفيذ

هذا تدقيق للبنية والإعدادات والكود، وليس إثبات نجاح جميع رحلات الاستخدام. لم تُنسخ أي بيانات Dev، ولم تُنشأ الجداول الناقصة ضمن نشر إصلاح عرض السائقين والمطاعم والعملاء والمناطق.

## نشر إصلاح العرض

- اكتمل تحديث stack `whizz-centralplatform-frontend-staging`، ودور admin-data مخصص بمجموعة admins عبر قواعد Identity Pool، والدعم بقي بلا صلاحيات DynamoDB.
- فحص IAM Simulator أكد السماح للمراجعة الإدارية ومنع دور الدعم من Scan/UpdateItem على جدول السائقين.
- Cognito يسمح الآن بإنشاء حسابات المنصة إدارياً فقط.
- نجح نشر Amplify على الفرع staging، job 13.
- نجحت اختبارات التكامل المعزول الأربع؛ لم يُجر اختبار متصفح بجلسة إدارة فعلية، ولم يُغيَّر اعتماد أي سائق.
