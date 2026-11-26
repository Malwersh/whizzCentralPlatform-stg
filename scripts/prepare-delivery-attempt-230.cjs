'use strict';
const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript');
const p='/private/tmp/attempt-230';
const parse=s=>ts.createSourceFile('index.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const find=(s,name)=>{const t=parse(s),nodes=t.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(nodes.length!==1)throw Error('FUNCTION_DRIFT:'+name);return {t,n:nodes[0]};};
let financial=fs.readFileSync(p+'/financial/index.js','utf8');
const compiled=fs.readFileSync('backend/wallet-service/dist/driverFinancialRuntime.js','utf8');
let addition=find(compiled,'financialDeliveryAttempt').n.getText(parse(compiled));
addition=addition.replace('(0, deliveryAttempt_1.createDeliveryAttempt)', 'require("./order-exception-runtime-229.js").createDeliveryAttempt')
 .replace(/\(0, financialIdentity_1.authenticateFinancialIdentity\)/g,'authenticateFinancialIdentity');
// Other configuration/client references are lexical functions already present in the captured runtime.
if(/\b\w+_1\./.test(addition))throw Error('UNBOUND_COMPILED_DEPENDENCY');
const handler=find(financial,'financialAcceptanceHandler');
let chunk=handler.n.getText(handler.t);
const actionAnchor='"cancel_before_pickup"].includes(event.action)';
if(chunk.split(actionAnchor).length!==3)throw Error('ACTION_ANCHOR_DRIFT');
// Extend only the admission list, retaining original assignment dispatch.
chunk=chunk.replace(actionAnchor,'"cancel_before_pickup", "start_delivery_attempt", "read_delivery_attempt", "record_contact_attempt"].includes(event.action)');
const dispatch='const result = event.action === "read_offer"';
if(!chunk.includes(dispatch))throw Error('DISPATCH_DRIFT');
chunk=chunk.replace(dispatch,'const result = ["start_delivery_attempt", "read_delivery_attempt", "record_contact_attempt"].includes(event.action) ? await financialDeliveryAttempt(event.action,event.body,event.accessToken) : event.action === "read_offer"');
const errors=['INVALID_DELIVERY_ATTEMPT','DELIVERY_ATTEMPT_CONFLICT','ORDER_EXCEPTION_POLICY_REQUIRED','ARRIVAL_LOCATION_REQUIRED','ARRIVAL_LOCATION_STALE','ARRIVAL_OUTSIDE_RADIUS','CONTACT_ATTEMPT_TOO_SOON','NO_RESPONSE_REQUIREMENTS_NOT_MET','EXCEPTION_SETTINGS_UNAVAILABLE','INVALID_EXCEPTION_SETTINGS'];
chunk=chunk.replace('const allowed = [','const allowed = ['+errors.map(x=>JSON.stringify(x)).join(',')+',');
financial=financial.slice(0,handler.n.getStart(handler.t))+addition+'\n'+chunk+financial.slice(handler.n.end);
fs.writeFileSync(p+'/financial-candidate.js',financial);
let staff=fs.readFileSync(p+'/staff/_discount_review/central-staff/index.js','utf8');
const start=staff.indexOf('var require_operational_settings = __commonJS({');if(start<0)throw Error('STAFF_MODULE_DRIFT');
const at=staff.indexOf('async function route(ctx, actor, method, path, input) {',start);if(at<0)throw Error('STAFF_ROUTE_DRIFT');
const end=at+'async function route(ctx, actor, method, path, input) {'.length;
staff=staff.slice(0,end)+'\n      if(path === "/staff/settings/order-exceptions" || path.startsWith("/staff/settings/order-exceptions/")) return require("../../order-exception-settings.js").route(ctx,actor,method,path,input);'+staff.slice(end);
fs.writeFileSync(p+'/staff-candidate.js',staff);
// Driver source overlay must contain only the new attempt route and policy DTO, plus delegation client additions.
const old=fs.readFileSync(p+'/driver/lambda_driver_api_v2.js','utf8'),next=fs.readFileSync('../whizzDrivers-stg/backend/lambda_driver_api_v2.js','utf8');
const prefix="'use strict';\nrequire(\"./finance-rollout-config-208.js\").restoreFinanceRolloutConfig();\n";
if(!old.startsWith(prefix))throw Error('DRIVER_ROLLOUT_BOOTSTRAP_DRIFT');
fs.writeFileSync(p+'/driver-candidate.js',prefix+next);
console.log('Prepared bounded financial and staff bridges; driver diff requires separate review.');
