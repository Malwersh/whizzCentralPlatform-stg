'use strict';
const ts=require('../backend/wallet-service/node_modules/typescript');
function adapt(source){
 const file=ts.createSourceFile('index.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),changes=[];
 const statements=file.statements.filter(ts.isVariableStatement);
 const route=statements.find(s=>s.declarationList.declarations.some(d=>d.name.getText(file)==='require_settlement_schedules'));
 if(!route||!route.getText(file).includes('backend/staff-service/settlement-schedules.js'))throw Error('EXACT_SETTLEMENT_MODULE_REQUIRED');
 changes.push({start:route.getStart(file),end:route.getEnd(),text:'var require_settlement_schedules = () => require("../../settlement-schedules.js");'});
 const owner=statements.find(s=>s.declarationList.declarations.some(d=>d.name.getText(file)==='require_commercial_owner'));
 if(!owner||!owner.getText(file).includes('backend/staff-service/commercial-owner.js'))throw Error('EXACT_OWNER_MODULE_REQUIRED');
 const text=owner.getText(file),needle='async function handle(ctx, event) {';
 if(text.split(needle).length!==2)throw Error('EXACT_OWNER_HANDLER_REQUIRED');
 const at=owner.getStart(file)+text.indexOf(needle)+needle.length;
 changes.push({start:at,end:at,text:'\n      if (event?.action === "settlement_schedule_owner") return require("../../commercial-owner.js").handle(ctx, event);'});
 let output=source;for(const c of changes.sort((a,b)=>b.start-a.start))output=output.slice(0,c.start)+c.text+output.slice(c.end);
 return {output,changes:changes.map(({start,end})=>({start,end})),preservedCommercialOwnerBranch:true};
}
module.exports={adapt};
if(require.main===module){const fs=require('node:fs');fs.writeFileSync(process.argv[3],adapt(fs.readFileSync(process.argv[2],'utf8')).output);}
