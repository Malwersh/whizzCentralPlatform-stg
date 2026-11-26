"""Reuse the staging return workspace within the production administration shell."""
import hashlib
import re

from prepare_customer_storefront import REPO

PAGE = 'pages/order-returns.html'
SCRIPTS = ('case-workflow.js','case-continuation.js','order-exception-cases.js',
           'return-operations-settings.js','settings-order-exceptions.js')


def order_return_assets():
    front = REPO/'frontend'
    source = (front/'pages/order-exceptions.html').read_text()
    data = source[source.index('<div class="case-heading">'):source.index('</main>')]
    head_end = data.index('<p id="message"')
    data = (
        '<header><div><h1>المرتجعات بعد الاستلام</h1>'
        '<p class="page-intro">تابع استعداد الفرع واستلام الأصناف ومراجعة الضمان والمستحقات.</p></div></header>'
        + data[head_end:]
    )
    data = data.replace('القضايا المفتوحة','المرتجعات المفتوحة').replace('معرف الطلب','رقم الطلب')
    data = data.replace('عرض قضايا الطلب','عرض مرتجعات الطلب')
    data = data.replace('تظهر الحالات الجديدة هنا. يمكنك البحث عن طلب لعرض قضاياه المسجلة سابقًا أيضًا.',
                        'ابحث برقم الطلب لعرض المرتجعات المغلقة أيضًا.')
    data = data.replace('تحديث القضايا المفتوحة','تحديث المرتجعات المفتوحة')
    setting = re.search(r'<section id="exception-settings".*?</section>',(front/'pages/settings.html').read_text(),re.S)[0]
    policies = data.index('<section class="card"><h2>سياسة العودة التلقائية')
    data = (data[:policies]+'<details class="workflow-card"><summary>إعدادات محاولات التسليم والإرجاع</summary>'
            +setting+data[policies:]+'</details>')
    assets = {name:(front/name).read_bytes() for name in SCRIPTS}
    assets['case-workflow.js'] = assets['case-workflow.js'].replace(
        b"new URL('finance.html',location.href)", b"new URL('merchant-settlements.html',location.href)")
    actions = assets['order-exception-cases.js']
    actions = actions.replace(
        b'window.WizzCaseUI.feedback(kind,notice);',
        b"window.WizzCaseUI.feedback(kind,notice);text(el('message'),notice);")
    assets['order-exception-cases.js'] = actions
    scripts = [
        '<script src="/config.js" defer></script>',
        '<script src="/assets/js/auth-utils.js" defer></script>',
    ]
    for name,data_bytes in assets.items():
        version = hashlib.sha256(data_bytes).hexdigest()[:12]
        scripts.append(f'<script src="/{name}?v={version}" defer></script>')
    markup = ('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'
              '<meta name="viewport" content="width=device-width,initial-scale=1">'
              '<title>المرتجعات بعد الاستلام — إدارة ويز</title>'
              '<link rel="stylesheet" href="/portal.css">'
              '<link rel="stylesheet" href="/styles/finance-workflow.css">'
              +''.join(scripts)+'</head><body><main>'+data+'</main></body></html>')
    return {PAGE:markup.encode(),**assets}
