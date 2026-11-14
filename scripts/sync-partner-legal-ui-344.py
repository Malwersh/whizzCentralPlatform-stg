"""Reuse tested policy reader across apps; only role default and design-token import differ."""
import pathlib,shutil
root=pathlib.Path(__file__).resolve().parents[1];user=root.parent/'wizzuser-stg/frontend/lib'
for repo,audience,color in [('whizzDrivers-stg','DRIVER','../app_colors.dart'),('whizzMerchants-stg','MERCHANT','../core/theme/app_colors.dart')]:
 lib=root.parent/repo/'frontend/lib';folder=lib/'legal';folder.mkdir(exist_ok=True)
 model=(user/'models/customer_legal_bundle.dart').read_text().replace('CustomerLegalBundle','ApplicationLegalBundle')
 service=(user/'services/customer_legal_service.dart').read_text().replace("import '../models/customer_legal_bundle.dart';","import 'application_legal_bundle.dart';").replace("import 'customer_phone_auth_service.dart';",'').replace('CustomerLegalService','ApplicationLegalService').replace('CustomerLegalBundle','ApplicationLegalBundle').replace("this.baseUrl = CustomerPhoneAuthService.baseUrl,","this.baseUrl = const String.fromEnvironment('LEGAL_API_BASE_URL',defaultValue:'https://f44z33oz55.execute-api.us-east-1.amazonaws.com/staging'),").replace("this.audience='CUSTOMER'",f"this.audience='{audience}'").replace("this.audience = 'CUSTOMER'",f"this.audience = '{audience}'")
 screen=(user/'screens/customer_legal_screen.dart').read_text().replace("import '../constants/app_colors.dart';",f"import '{color}';").replace("import '../models/customer_legal_bundle.dart';","import 'application_legal_bundle.dart';").replace("import '../services/customer_legal_service.dart';","import 'application_legal_service.dart';").replace('CustomerLegal','ApplicationLegal')
 screen=screen.replace('assets/images/mainlogo.png','assets/images/wizz-company-primary.png')
 screen=screen.replace(f"import '{color}';\n",'').replace('AppColors.secondaryDark','const Color(0xFF00296B)')
 for name,text in [('application_legal_bundle.dart',model),('application_legal_service.dart',service),('application_legal_screen.dart',screen)]: (folder/name).write_text(text)
 shutil.copy2(root/'frontend/assets/brand/wizz-wordmark-blue.png',lib.parent/'assets/images/wizz-wordmark-blue.png')
 pub=lib.parent/'pubspec.yaml';s=pub.read_text()
 if '    - assets/images/wizz-wordmark-blue.png' not in s:s=s.replace('    - assets/images/\n','    - assets/images/\n    - assets/images/wizz-wordmark-blue.png\n',1);pub.write_text(s)
 backend=root.parent/repo/('backend' if audience=='DRIVER' else 'backend/functions/auth')
 for n in ['customer-legal-contract-344.js','customer-legal-defaults-344.json','driver-legal-defaults-344.json','merchant-legal-defaults-344.json']:shutil.copy2(root/'backend/shared'/n,backend/n)
