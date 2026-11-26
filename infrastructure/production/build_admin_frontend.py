"""Allowlisted production admin bootstrap UI. Does not copy env.js or business pages."""
import argparse,hashlib,json,re,shutil
from pathlib import Path
from build_cash_review_portal import cash_review_assets, PAGE as CASH_WORKSPACE
from build_order_returns_portal import order_return_assets, PAGE as RETURN_WORKSPACE
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent.parent
PLATFORM_PAGES=(
 'pages/dashboard.html','pages/drivers.html','pages/regions.html','pages/legal-documents.html',
 'pages/account-security.html','pages/notification-sounds.html','pages/driver-delivery-settings.html','pages/merchant-onboarding.html','pages/wallets.html','pages/order-cancellation.html',
 'pages/order-monitoring.html', 'pages/pickup-issues.html', RETURN_WORKSPACE, CASH_WORKSPACE,
 'pages/customer-home.html','pages/customer-interfaces.html','pages/merchants.html','pages/merchant-settlements.html',
 'pages/cancellation-compensation.html','pages/order-complaints.html','pages/benefits.html','pages/platform-campaigns.html',
 'pages/shared-funding.html',
)
NAVIGATION_GROUPS=(
 ('المتابعة', (('dashboard','الرئيسية'),)),
 ('التشغيل', (('order-monitoring','متابعة الطلبات'),('pickup-issues','بلاغات الاستلام'),('order-returns','المرتجعات بعد الاستلام'),('order-cancellation','طلبات الإلغاء'),('order-complaints','شكاوى الطلبات'),('drivers','السائقون'),('merchants','المطاعم والفروع'),('regions','مناطق الخدمة'))),
 ('المالية', (('merchant-settlements','مستحقات المطاعم والصرف'),('wallets','المحافظ'),('customer-cash-review','مراجعة النقد ورد المبالغ'))),
 ('تطبيق الزبون', (('customer-home','واجهات تطبيق الزبون'),)),
 ('العروض والتجربة', (('benefits','مزايا الزبائن'),
                      ('platform-campaigns','حملات الخصم'),('shared-funding','التمويل المشترك للعروض'))),
 ('الإعدادات', (('merchant-onboarding','الأنشطة واتفاقية الشراكة'),
                ('legal-documents','سياسات التطبيقات'),('account-security','حماية الحساب'),('notification-sounds','أصوات الإشعارات واستقبال الطلبات'),('driver-delivery-settings','خريطة السائق والتوصيل'))),
)
SHELL_ASSETS=('portal.css','portal.js','platform-shell.js','dashboard.css')
BRAND_ASSET='assets/brand/wizz-wordmark-yellow.png'
SETTLEMENT_SCRIPTS=(
 'finance-period-label.js','finance-print-company.js','merchant-payout-print.js',
 'settlement-statement-details.js','merchant-collection-print.js','merchant-period-collection.js',
 'settlement-statements.js','merchant-cashboxes.js','merchant-corrections.js','merchant-payouts.js',
 'merchant-period-print.js','merchant-financial-account.js','merchant-off-cycle.js',
 'finance-workspace.js','settlement-schedules.js','settlement-orders.js',
)
PAGE_SCOPE=['identity','driver-directory-read-only','regions-administration','legal-administration',
 'merchant-onboarding-administration','wallets-read-only','customer-home-layout',
 'merchant-directory-and-review','order-monitoring','order-cancellation-review','merchant-settlements','cancellation-compensation','customer-order-complaints','order-returns','platform-benefits','platform-campaigns','shared-funding']
LAYOUT_STYLE='<style>body.platform-layout{font-family:Wizz,Tahoma,sans-serif}.platform-layout main.platform-main{max-width:none;margin:0 248px 0 0;padding:32px}@media(max-width:800px){.platform-layout main.platform-main{margin:0;padding:20px 16px}}</style>'

def pickup_issues_assets():
 script=(REPO/'frontend/pickup-issues.js').read_bytes()
 revision=hashlib.sha256(script).hexdigest()[:12]
 page=(ROOT/'admin-web/pickup-issues.html').read_text()
 style=(ROOT/'admin-web/pickup-issues.css').read_bytes()
 style_revision=hashlib.sha256(style).hexdigest()[:12]
 page=page.replace('/pickup-issues.js','/pickup-issues.js?v='+revision)
 page=page.replace('/pickup-issues.css','/pickup-issues.css?v='+style_revision)
 return {'pages/pickup-issues.html':page.encode(),'pickup-issues.js':script,'pickup-issues.css':style}

def platform_shell_revision():
 sources=[ROOT/'admin-web'/name for name in SHELL_ASSETS]+[REPO/'frontend'/BRAND_ASSET]
 return hashlib.sha256(b''.join(path.read_bytes() for path in sources)).hexdigest()[:12]

def render_platform_page(content,name,revision,*,support_enabled=False):
 nav=['<nav aria-label="أقسام الإدارة">']
 for label,links in NAVIGATION_GROUPS:
  nav.append(f'<span class="nav-group-label">{label}</span>')
  for slug,title in links:
   page=f'pages/{slug}.html'
   active=' aria-current="page"' if page==name else ''
   nav.append(f'<a href="/{page}"{active}>{title}</a>')
  if label=='المتابعة' and support_enabled:
   active=' aria-current="page"' if name=='pages/support.html' else ''
   nav.append(f'<a href="/pages/support.html"{active}>محادثات الدعم</a>')
 nav.append('</nav>')
 sidebar=('<aside class="platform-sidebar" aria-label="القائمة الرئيسية">'
          '<a class="platform-brand" href="/pages/dashboard.html" aria-label="شركة الانطلاق الخاطف، منصة الإدارة، الصفحة الرئيسية">'
          f'<img src="/{BRAND_ASSET}?v={revision}" alt="" width="2413" height="1024">'
          '<span>شركة الانطلاق الخاطف</span>'
          '<span class="platform-brand-caption">منصة الإدارة</span></a>'+''.join(nav)+
          '<div class="platform-sidebar-footer"><button class="platform-logout" type="button">تسجيل الخروج</button></div></aside>')
 content,wrapped=re.subn(r'<aside class="platform-sidebar"[^>]*>.*?</aside>',lambda _:sidebar,content,count=1,flags=re.S)
 if not wrapped:
  content=re.sub(r'<body[^>]*>',lambda _:'<body class="platform-layout">'+sidebar,content,count=1)
  main_class='platform-main exceptions-content' if name==RETURN_WORKSPACE else 'platform-main'
  content=re.sub(r'<main([^>]*)>',lambda m:f'<main class="{main_class}"'+re.sub(r' class="[^"]*"','',m.group(1))+'>',content,count=1)
 content=re.sub(r'href="/portal\.css(?:\?[^"]*)?"',f'href="/portal.css?v={revision}"',content)
 content=re.sub(r'src="/portal\.js(?:\?[^"]*)?"',f'src="/portal.js?v={revision}"',content)
 content=re.sub(r'href="/dashboard\.css(?:\?[^"]*)?"',f'href="/dashboard.css?v={revision}"',content)
 content=re.sub(r'<script src="/platform-shell\.js(?:\?[^"]*)?" defer></script>','',content)
 style='' if LAYOUT_STYLE in content else LAYOUT_STYLE
 return content.replace('</head>',f'<script src="/platform-shell.js?v={revision}" defer></script>'+style+'</head>',1)

def build(output,vendors,*,support_socket_url=None):
 output=Path(output);vendors=Path(vendors)
 if output.exists() and any(output.iterdir()):raise ValueError('Output must be empty; never overwrite an existing deployment')
 evidence=json.loads((ROOT/'admin-web/vendor-sources.json').read_text())
 expected={'amazon-cognito-identity.min.js':'https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@6.3.12/dist/amazon-cognito-identity.min.js','aws-sdk.min.js':'https://sdk.amazonaws.com/js/aws-sdk-2.1544.0.min.js'}
 if {x['file']:x['url'] for x in evidence}!=expected:raise ValueError('Unexpected vendor sources')
 for x in evidence:
  if hashlib.sha256((vendors/x['file']).read_bytes()).hexdigest()!=x['sha256']:raise ValueError('Vendor hash mismatch')
 def write(name,data):
  p=output/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data if isinstance(data,bytes) else data.encode())
 front=REPO/'frontend'
 for name in ['assets/js/wizz-locale.js','styles/arabic-font.css','styles/arabic-ui.css','assets/fonts/NotoSansArabic.ttf','assets/fonts/OFL-NotoSansArabic.txt','account-security.js']:
  write(name,(front/name).read_bytes())
 write(BRAND_ASSET,(front/BRAND_ASSET).read_bytes())
 for x in evidence:write('vendor/'+x['file'],(vendors/x['file']).read_bytes())
 auth=(front/'assets/js/auth-utils.js').read_text().split('// Auth Debug Overlay (optional)')[0]
 write('assets/js/auth-utils.js',auth)
 index=(front/'index.html').read_text().replace('<script src="./env.js"></script>','')
 index=index.replace('https://sdk.amazonaws.com/js/aws-sdk-2.1471.0.min.js','/vendor/aws-sdk.min.js').replace(expected['amazon-cognito-identity.min.js'],'/vendor/amazon-cognito-identity.min.js')
 index=index.replace('<script src="./config.js"></script>','<script src="./config.js"></script><script src="./assets/js/auth-utils.js"></script>')
 index=index.replace('8 أحرف على الأقل','14 حرفًا على الأقل')
 write('index.html',index)
 login=(front/'assets/js/login.js').read_text()
 start=login.index('    if(profile.employee.roles.includes(');end=login.index('\n  }\n  try {',start)
 login=login[:start]+"    return getPostLoginUrl();"+login[end:]
 login=login.replace("const returnUrl = readStorageItem('returnUrl');","const candidate = readStorageItem('returnUrl');\n              const returnUrl = ['/pages/dashboard.html','/pages/account-security.html'].includes(candidate) ? candidate : null;")
 login=login.replace('log(`Starting authentication for: ${email}`, \'info\');',"log('Starting production authentication', 'info');")
 login=login.replace('.{8,}$/;','.{14,}$/;')
 write('assets/js/login.js',login)
 config={'STAGE':'production','APP_NAME':'إدارة ويز','COGNITO_REGION':'us-east-1','COGNITO_USER_POOL_ID':'us-east-1_njh6vaNWj','COGNITO_CLIENT_ID':'7924qedsr5m1j1bvc3c7va8egk','STAFF_API_BASE_URL':'','DEFAULT_POST_LOGIN_PAGE':'/pages/dashboard.html'}
 # The session API is routed on the same origin by the dedicated hosting stack.
 write('config.js',"'use strict';\nwindow.WIZZCENTRAL_CONFIG=Object.freeze("+json.dumps(config,ensure_ascii=False)+");\n")
 # Existing clients concatenate the configured base and /staff/*.
 write('config.js',(output/'config.js').read_text().replace('"STAFF_API_BASE_URL": ""','"STAFF_API_BASE_URL": window.location.origin'))
 for name in ('first_nitification_sound.wav','driver_original.wav','merchant_bell.wav','driver_offer.wav','online_chime.wav','soft_chime.wav'):
  path='assets/sounds/'+name
  write(path,(REPO/'frontend'/path).read_bytes())
 for source,target in [('dashboard.html','pages/dashboard.html'),('dashboard.css','dashboard.css'),('account-security.html','pages/account-security.html'),('notification-sounds.html','pages/notification-sounds.html'),('notification-sounds.js','notification-sounds.js'),('driver-delivery-settings.html','pages/driver-delivery-settings.html'),('settings-driver-map-329.js','settings-driver-map-329.js'),('settings-delivery-operations.js','settings-delivery-operations.js'),('portal.css','portal.css'),('portal.js','portal.js'),('wallets.html','pages/wallets.html'),('wallets.js','wallets.js'),('drivers.html','pages/drivers.html'),('drivers.js','drivers.js'),('driver-review.js','driver-review.js'),('regions.html','pages/regions.html'),('merchant-onboarding.html','pages/merchant-onboarding.html'),('merchant-onboarding.js','merchant-onboarding.js'),('customer-home.html','pages/customer-home.html'),('customer-interfaces.html','pages/customer-interfaces.html'),('customer-interfaces.js','customer-interfaces.js'),('customer-home.js','customer-home.js'),('customer-home-slides.js','customer-home-slides.js'),('customer-home.css','customer-home.css'),('merchants.html','pages/merchants.html'),('merchants.js','merchants.js'),('merchants.css','merchants.css'),('merchant-commercial.js','merchant-commercial.js')]:write(target,(ROOT/'admin-web'/source).read_bytes())
 driver_page=(output/'pages/drivers.html').read_text()
 for name in ('driver-quality-review.js','driver-performance-review.js','drivers.js'):
  content=(ROOT/'admin-web'/name).read_bytes()
  write(name,content)
  revision=hashlib.sha256(content).hexdigest()[:12]
  driver_page=driver_page.replace(f'/{name}"',f'/{name}?v={revision}"')
 write('pages/drivers.html',driver_page)
 write('merchant-staff-policy.js',(ROOT/'admin-web/merchant-staff-policy.js').read_bytes())
 merchants=(output/'pages/merchants.html').read_text()
 for name in ('merchants.css','merchants.js','merchant-staff-policy.js','merchant-commercial.js'):
  version=hashlib.sha256((output/name).read_bytes()).hexdigest()[:12]
  merchants=merchants.replace('/'+name+'"','/'+name+'?v='+version+'"')
 write('pages/merchants.html',merchants)
 write('pages/order-cancellation.html',(ROOT/'admin-web/order-cancellation.html').read_bytes())
 monitor=(ROOT/'admin-web/order-monitoring.html').read_text()
 for name in ('order-monitoring.css','order-monitoring.js'):
  asset=(ROOT/'admin-web'/name).read_bytes()
  monitor=monitor.replace(f'/{name}"',f'/{name}?v={hashlib.sha256(asset).hexdigest()[:12]}"')
  write(name,asset)
 write('pages/order-monitoring.html',monitor)
 for name,source in pickup_issues_assets().items():
  write(name,source)
 complaints=(ROOT/'admin-web/order-complaints.html').read_text()
 for name in ('order-complaints.js','order-complaints.css'):
  source=(ROOT/'admin-web'/name).read_bytes()
  version=hashlib.sha256(source).hexdigest()[:12]
  complaints=complaints.replace(f'/{name}"',f'/{name}?v={version}"')
  write(name,source)
 write('pages/order-complaints.html',complaints)
 benefits=(ROOT/'admin-web/benefits.html').read_text()
 benefits_script=(front/'platform-benefits-admin.js').read_bytes()
 version=hashlib.sha256(benefits_script).hexdigest()[:12]
 write('pages/benefits.html',benefits.replace('/platform-benefits-admin.js"',f'/platform-benefits-admin.js?v={version}"'))
 write('platform-benefits-admin.js',benefits_script)
 campaigns=(ROOT/'admin-web/platform-campaigns.html').read_text()
 for name in ('platform-campaigns.js','platform-campaigns.css'):
  asset=(ROOT/'admin-web'/name).read_bytes()
  version=hashlib.sha256(asset).hexdigest()[:12]
  campaigns=campaigns.replace(f'/{name}"',f'/{name}?v={version}"')
  write(name,asset)
 write('pages/platform-campaigns.html',campaigns)
 funding=(ROOT/'admin-web/shared-funding.html').read_text()
 for name in ('shared-funding.js','shared-funding.css','platform-campaigns.css'):
  asset=(ROOT/'admin-web'/name).read_bytes()
  version=hashlib.sha256(asset).hexdigest()[:12]
  funding=funding.replace(f'/{name}"',f'/{name}?v={version}"')
  if name.startswith('shared-funding'):write(name,asset)
 write('pages/shared-funding.html',funding)
 for name in ('order-cancellation.js','order-cancellation.css'):
  write(name,(ROOT/'admin-web'/name).read_bytes())
 compensation=(front/'pages/cancellation-compensation.html').read_text()
 compensation=re.sub(r'<script src="[^"]+"></script>','',compensation)
 compensation=compensation.replace('../styles/material-3-design-system.css','/portal.css')
 compensation=compensation.replace('href="order-exceptions.html"','href="order-cancellation.html"')
 compensation=compensation.replace('href="financial-management.html"','href="merchant-settlements.html"')
 script=(front/'cancellation-compensation.js').read_bytes()
 version=hashlib.sha256(script).hexdigest()[:12]
 scripts='<script src="/config.js" defer></script><script src="/assets/js/auth-utils.js" defer></script>'
 scripts+=f'<script src="/cancellation-compensation.js?v={version}" defer></script>'
 write('pages/cancellation-compensation.html',compensation.replace('</head>',scripts+'</head>',1))
 write('cancellation-compensation.js',script)
 tags=[]
 for name in SETTLEMENT_SCRIPTS:
  content=(front/name).read_text()
  if name=='finance-print-company.js':
   content=content.replace("location.origin==='null'?'https://staging.d2vmebm1e1n95m.amplifyapp.com':location.origin","location.origin")
  write(name,content)
  version=hashlib.sha256(content.encode()).hexdigest()[:12]
  tags.append(f'<script src="/{name}?v={version}" defer></script>')
 settlement=(ROOT/'admin-web/merchant-settlements.html').read_text()
 write('pages/merchant-settlements.html',settlement.replace('<!-- settlement-scripts -->','\n  '.join(tags)))
 write('merchant-settlements-page.js',(ROOT/'admin-web/merchant-settlements-page.js').read_bytes())
 write('merchant-settlements.css',(ROOT/'admin-web/merchant-settlements.css').read_bytes())
 write('styles/finance-workflow.css',(front/'styles/finance-workflow.css').read_bytes())
 for name in ['region-management-312.js','region-management-312.css','region-geometry-worker-312.js','region-geometry-runtime-312.js']:
  content=(front/name).read_bytes()
  if name=='region-management-312.js':
   content=content.decode().replace('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png','https://tile.openstreetmap.org/{z}/{x}/{y}.png').replace("{attribution:'© OpenStreetMap contributors',maxZoom:19}","{attribution:'© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors',maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin'}")
   version=hashlib.sha256(content.encode()).hexdigest()[:12]
   page=(output/'pages/regions.html').read_text()
   write('pages/regions.html',page.replace('src="/region-management-312.js"','src="/region-management-312.js?v='+version+'"'))
  write(name,content)
 # Reuse the tested policy editor with production-only authentication/assets.
 legal=(front/'pages/legal-documents.html').read_text()
 legal=re.sub(r'<script src="[^"]+"></script>','',legal)
 legal=legal.replace('../styles/material-3-design-system.css','/portal.css').replace('href="settings.html"','href="/pages/dashboard.html"').replace('← الإعدادات','الرئيسية')
 legal=legal.replace('<head>','<head><script src="/config.js"></script><script src="/vendor/aws-sdk.min.js"></script><script src="/vendor/amazon-cognito-identity.min.js"></script><script src="/assets/js/auth-utils.js"></script>')
 legal=legal.replace('</body>','<script src="/customer-legal-settings-344.js"></script></body>')
 write('pages/legal-documents.html',legal)
 editor=(front/'customer-legal-settings-344.js').read_text().replace('schemaVersion:1,brand:state.current.brand','schemaVersion:1,audience,brand:state.current.brand')
 editor=re.sub(r"RECENT_AUTH_REQUIRED:'[^']*'", "RECENT_AUTH_REQUIRED:'يلزم تحقق أمني حديث للنشر فقط. مسودتك المحفوظة باقية؛ أعد تسجيل الدخول ثم انشرها دون إعادة الحفظ.'", editor)
 write('customer-legal-settings-344.js',editor)
 for name in ['wizz-primary.png','wizz-wordmark-blue.png']:write('assets/brand/'+name,(front/'assets/brand'/name).read_bytes())
 for name,data in {**order_return_assets(),**cash_review_assets()}.items():write(name,data)
 write('platform-shell.js',(ROOT/'admin-web/platform-shell.js').read_bytes())
 pages=PLATFORM_PAGES
 if support_socket_url:
  if not re.fullmatch(r'wss://[a-z0-9]{10}[.]execute-api[.]us-east-1[.]amazonaws[.]com/production',support_socket_url):
   raise ValueError('Expected the deployed production support WebSocket URL')
  support=(ROOT/'admin-web/support.html').read_text()
  preview=(front/'js/support/SupportAttachments.js').read_text()
  preview=preview.replace("new URL(global.WIZZCENTRAL_CONFIG?.SUPPORT_ATTACHMENTS_API_URL || '')",
                          "new URL('/support-api/attachments', global.location.origin)")
  preview=preview.replace("global.Auth.getToken('idToken')", "global.Auth.getToken('accessToken')")
  preview=preview.replace(
   "const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));\n                const url = URL.createObjectURL(new Blob([bytes], {type: payload.contentType}));",
   "const url = 'data:' + payload.contentType + ';base64,' + payload.dataBase64;")
  preview=preview.replace("                img.onload = () => URL.revokeObjectURL(url);\n", "")
  preview=preview.replace("URL.revokeObjectURL(url); img.remove();", "img.remove();")
  for name,content in (
   ('support.css',(ROOT/'admin-web/support.css').read_text()),
   ('support.js',(ROOT/'admin-web/support.js').read_text()),
   ('support-attachments.js',preview),
   ('support-config.js','window.WIZZ_SUPPORT_CONFIG=Object.freeze('+json.dumps({'socketUrl':support_socket_url})+');'),
  ):
   write(name,content)
   version=hashlib.sha256(content.encode()).hexdigest()[:12]
   support=support.replace(f'/{name}"',f'/{name}?v={version}"')
  write('pages/support.html',support)
  pages=(*pages,'pages/support.html')
 revision=platform_shell_revision()
 for name in pages:
  content=(output/name).read_text().replace('target="_blank"','')
  write(name,render_platform_page(content,name,revision,support_enabled=bool(support_socket_url)))
 region_vendors=json.loads((ROOT/'admin-web/region-vendor-sources.json').read_text())
 for item in region_vendors:
  data=(vendors/item['file']).read_bytes()
  if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Region vendor hash mismatch')
  write('vendor/'+item['file'],data)
 forbidden=['699561669180','031857856164','146152253137','7oum9md7v6','us-east-1_Cp9YnOQWi','5hun8p61grnakisu5gammcjelv']
 for p in output.rglob('*'):
  if p.suffix in ['.js','.html','.css']:
   text=p.read_text()
   if any(x in text for x in forbidden):raise ValueError('Non-production reference in '+str(p))
 files={str(p.relative_to(output)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.rglob('*')) if p.is_file()}
 return {'accountId':'746727375268','status':'ADMIN_IDENTITY_AND_DRIVER_READ_ONLY','vendorSources':evidence,'files':files,'businessPagesIncluded':True,'pageScope':PAGE_SCOPE+(['support-chat'] if support_socket_url else []),'sessionsCopied':False}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--vendors',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--support-socket-url');args=p.parse_args();report=build(args.output,args.vendors,support_socket_url=args.support_socket_url);args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('Production bootstrap UI built with '+str(len(report['files']))+' allowlisted files.')
