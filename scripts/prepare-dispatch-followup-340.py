from pathlib import Path
import copy,hashlib,json,subprocess,zipfile
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/dispatch-followup-340')
def sha(b):return hashlib.sha256(b).hexdigest()
review={'part':340,'functions':[],'financialModulesPreserved':True,'newFinancialActions':False}
for tag in ['staff','integration']:
 z=zipfile.ZipFile(P/(tag+'-base.zip'));changes={}
 if tag=='staff':
  name='_discount_review/central-staff/index.js';s=z.read(name).decode();a=s.index('// backend/staff-service/dispatch-reviews.js\n');b=s.index('\n// backend/',a+60)
  s=s[:a]+'''// backend/staff-service/dispatch-reviews.js: reviewed followup adapter 340
var require_dispatch_reviews = __commonJS({
 "backend/staff-service/dispatch-reviews.js"(exports2,module2) {
  module2.exports = require("../../dispatch-reviews-340.js");
 }
});
'''+s[b:]
  anchor='    if (path === "/staff/dispatch-reviews" || path.startsWith("/staff/dispatch-reviews/")) {';assert s.count(anchor)==1;assert s.count('var require_operational_settings =')==1
  insert='''    if (path === "/staff/settings/dispatch-followup" || path.startsWith("/staff/settings/dispatch-followup/")) return response(200, await require("../../dispatch-reviews-340.js").followupSettings({db,table,employee,guard,audit,requirePermission,recent,claims,allowed,enrolled,settingsRoute:require_operational_settings().route},actor,method,path,input));
'''
  s=s.replace(anchor,insert+anchor);changes[name]=s.encode();changes['dispatch-reviews-340.js']=(P/'dispatch-reviews-340.js').read_bytes()
 else:
  name='index.js';s=z.read(name).decode();old='const review = await require("./dispatch-review-host-298.js").handler(event, context2 ?? {});';assert s.count(old)==1;s=s.replace(old,'const review = await require("./dispatch-followup-runtime-340.js").handler(event, context2 ?? {});');changes[name]=s.encode()
  changes['dispatch-followup-runtime-340.js']=(R/'backend/staff-service/dispatch-followup-runtime.js').read_bytes();changes['dispatch-followup-monitor-340.js']=(P/'dispatch-followup-monitor-340.js').read_bytes()
 candidate=P/(tag+'-candidate.zip')
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for f,data in changes.items():
   if f not in z.namelist():out.writestr(f,data)
 with zipfile.ZipFile(candidate) as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
 for f,data in changes.items():
  if f.endswith('.js'):
   check=P/('syntax-'+tag+'-'+Path(f).name);check.write_bytes(data);subprocess.run(['node','--check',str(check)],check=True)
 config=json.loads((P/(tag+'-config.private.json')).read_text());review['functions'].append({'tag':tag,'name':config['FunctionName'],'baseCodeSha256':config['CodeSha256'],'candidateSHA256':sha(candidate.read_bytes()),'changedFiles':list(changes),'otherEntriesPreserved':True})
(P/'candidate-review.json').write_text(json.dumps(review,indent=2)+'\n');print(json.dumps(review,indent=2))
