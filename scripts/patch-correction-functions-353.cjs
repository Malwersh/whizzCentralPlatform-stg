'use strict';
// Minimal AST overlays: keep surrounding live code, including prior runtime patches.
const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript');
const [source,dest,reportFile]=process.argv.slice(2),s=fs.readFileSync(source,'utf8'),ast=ts.createSourceFile(source,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let sdk='require("@aws-sdk/lib-dynamodb")';
for(const st of ast.statements)if(ts.isVariableStatement(st))for(const d of st.declarationList.declarations)if(ts.isObjectBindingPattern(d.name)&&d.name.elements.some(e=>e.name.getText(ast)==='DynamoDBDocumentClient')&&d.initializer&&ts.isCallExpression(d.initializer))sdk=d.initializer.getText(ast);
const helper='function __correctionDb353(client){return {send(command){const sdk='+sdk+',type=command?.constructor?.name?.replace(/\\d+$/,"");if(!["GetCommand","QueryCommand","ScanCommand","BatchGetCommand","PutCommand","UpdateCommand","DeleteCommand","TransactWriteCommand"].includes(type)||typeof sdk[type]!=="function")throw Error("CORRECTION_DDB_COMMAND_INVALID");return client.send(new sdk[type](command.input));}};}\n';
const wanted=new Set(['createMerchantPayoutService','verifyMerchantPayoutJournal','readMerchantStatementPayment','createExceptionFinancialClosure','createCancellationCompensation']),edits=[],moduleTargets=new Map([['backend/staff-service/merchant-payouts.js','merchant-payouts.js'],['backend/staff-service/merchant-account.js','merchant-account.js'],['backend/staff-service/order-exception-cases.js','order-exception-cases.js']]);
function visit(n){
 if(ts.isMethodDeclaration(n)&&n.name&&moduleTargets.has(n.name.text)&&n.body){const target=moduleTargets.get(n.name.text),mod=n.parameters[1].name.getText(ast);const body=target!=='merchant-account.js'?'{const api=require(process.env.LAMBDA_TASK_ROOT+"/'+target+'");'+mod+'.exports={matches:api.matches,route(ctx,...args){return api.route({...ctx,db:__correctionDb353(ctx.db)},...args);}};}':'{const api=require(process.env.LAMBDA_TASK_ROOT+"/merchant-account.js");'+mod+'.exports={...api,read(db,...args){return api.read(__correctionDb353(db),...args);}};}';edits.push({start:n.body.getStart(ast),end:n.body.end,name:'module:'+target,body});return;}
 if(ts.isFunctionDeclaration(n)&&n.name&&wanted.has(n.name.text)&&n.body){const name=n.name.text,body=['createMerchantPayoutService','createExceptionFinancialClosure','createCancellationCompensation'].includes(name)?'{const args=[...arguments];args[0]={...args[0],db:__correctionDb353(args[0].db)};return require(process.env.LAMBDA_TASK_ROOT+"/merchant-payout-corrections-353.js").'+name+'(...args);}':name==='readMerchantStatementPayment'?'{const args=[...arguments];args[0]=__correctionDb353(args[0]);return require(process.env.LAMBDA_TASK_ROOT+"/merchant-payout-corrections-353.js").'+name+'(...args);}':'{return require(process.env.LAMBDA_TASK_ROOT+"/merchant-payout-corrections-353.js").'+name+'(...arguments);}';edits.push({start:n.body.getStart(ast),end:n.body.end,name,body});return;}
 ts.forEachChild(n,visit);
}visit(ast);
const sorted=[...edits].sort((a,b)=>b.start-a.start);for(let i=1;i<sorted.length;i++)if(sorted[i].end>sorted[i-1].start)throw Error('OVERLAPPING_OVERLAY');
let out=s;for(const e of sorted)out=out.slice(0,e.start)+e.body+out.slice(e.end);
let routes=0;
const company='require("../../company-accounts-281.js").route({db,table';if(out.includes(company)){if(out.split(company).length!==2)throw Error('COMPANY_ROUTE_CHANGED');out=out.replace(company,'require("../../company-accounts.js").route({db:__correctionDb353(db),table');routes++;}
// Only extend the sanitized error prefixes in the existing live wrappers.
let errorPrefixes=0;out=out.replace(/\^\(\?:PAYOUT_\|SCHEDULE_/g,()=>{errorPrefixes++;return '^(?:CORRECTION_|PAYOUT_|SCHEDULE_';}).replace(/\/\^PAYOUT_\//g,()=>{errorPrefixes++;return '/^(PAYOUT_|CORRECTION_)/';});
if(edits.length||routes)out=helper+out;
fs.writeFileSync(dest,out);fs.writeFileSync(reportFile,JSON.stringify({functions:edits.map(e=>e.name),companyRoute:routes,errorPrefixes,hostSdk:sdk,originalLength:s.length,replacedRanges:edits.map(({body,...e})=>e),otherTextPreserved:true},null,2));
