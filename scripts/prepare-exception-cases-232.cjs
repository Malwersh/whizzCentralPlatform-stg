'use strict';
const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const dir='/private/tmp/exceptions-232',parse=s=>ts.createSourceFile('entry.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function node(s,name){const t=parse(s),matches=t.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(matches.length!==1)throw Error('FUNCTION_DRIFT:'+name);return {t,n:matches[0]};}
function replace(s,name,text){const {t,n}=node(s,name);return s.slice(0,n.getStart(t))+text+s.slice(n.end);}
let financial=fs.readFileSync(dir+'/financial/index.js','utf8'),canonical=fs.readFileSync('backend/wallet-service/dist/driverFinancialRuntime.js','utf8');
financial=replace(financial,'createStagingCodReassignment','function createStagingCodReassignment(options){return require("./order-exception-runtime-229.js").createStagingCodReassignment(options);}');
for(const name of ['financialCustomerCancellation','financialExceptionCaseAdmin','financialAcceptanceHandler']){
 const {n,t}=node(canonical,name);let body=n.getText(t);
 for(const [module,symbol]of [['financialIdentity','authenticateFinancialIdentity'],['customerCancellation','createCustomerCancellation'],['exceptionStaffAuthority','createExceptionStaffAuthority'],['exceptionCaseAdministration','createExceptionCaseAdministration']])body=body.replaceAll('(0, '+module+'_1.'+symbol+')','require("./order-exception-runtime-229.js").'+symbol);
 body=body.replaceAll('(0, financialPushValidation_1.createStagingFinancialPushValidation)','createStagingFinancialPushValidation');
 if(/\b\w+_1\./.test(body))throw Error('UNBOUND_DEPENDENCY:'+name);
 if(name==='financialExceptionCaseAdmin'){if(financial.includes('function '+name+'('))throw Error('ALREADY_PRESENT');const {n:anchor,t:tree}=node(financial,'financialAcceptanceHandler');financial=financial.slice(0,anchor.getStart(tree))+body+'\n'+financial.slice(anchor.getStart(tree));}
 else financial=replace(financial,name,body);
}
fs.writeFileSync(dir+'/financial-candidate.js',financial);fs.copyFileSync('backend/shared/order-exception-runtime-229.js',dir+'/order-exception-runtime-229.js');
let staff=fs.readFileSync(dir+'/staff/_discount_review/central-staff/index.js','utf8');
const moduleStart=staff.indexOf('var require_operational_settings = __commonJS({');if(moduleStart<0)throw Error('SETTINGS_MODULE_DRIFT');const routeStart=staff.indexOf('async function route(',moduleStart),brace=staff.indexOf('{',routeStart);if(brace<0)throw Error('SETTINGS_ROUTE_DRIFT');staff=staff.slice(0,brace+1)+'\n if(path === "/staff/settings/order-exception-cases" || path.startsWith("/staff/settings/order-exception-cases/")) return require("../../order-exception-case-settings.js").route(ctx,actor,method,path,input);\n'+staff.slice(brace+1);
const anchor='if (path === "/staff/dispatch-reviews"';if(staff.split(anchor).length!==2)throw Error('STAFF_ROUTE_DRIFT');staff=staff.replace(anchor,'if (path === "/staff/order-exceptions" || path.startsWith("/staff/order-exceptions/")) {\n const result=await require("../../order-exception-cases.js").route({db,table,employee,guard,audit,enrolled,recent,claims,allowed,accessToken:token,query:event.queryStringParameters||{}},actor,method,path,input);\n return response(200,result);\n }\n '+anchor);
fs.writeFileSync(dir+'/staff-candidate.js',staff);
const merchant=esbuild.buildSync({entryPoints:['../whizzMerchants-stg/backend/functions/auth/order_returns.js'],bundle:true,platform:'node',target:'node20',external:['@aws-sdk/lib-dynamodb'],write:false}).outputFiles[0].contents;fs.writeFileSync(dir+'/merchant-auth-candidate.js',merchant);
console.log('Prepared bounded financial, staff and merchant entry changes.');
