'use strict';
function diagnostics(source) {
 const start=source.indexOf('function createFullCashCompletion(');
 if(start<0)return source;
 const capture=/\} catch \{\n(\s*)const recovered = prior\(await strongGet\(db, (T2|T)\.holds, outcomeKey\)\);/;
 const tail=source.slice(start);if(!capture.test(tail))throw Error('UNEXPECTED_COMPLETION_FAILURE_HANDLER');
 return source.slice(0,start)+tail.replace(capture,(_,indent,table)=>"} catch (error) {\n"+indent+"console.error('FULL_CASH_TRANSACTION_REJECTED', {name:typeof error?.name==='string'?error.name:'UnknownError',cancellations:Array.isArray(error?.CancellationReasons)?error.CancellationReasons.map((r,index)=>({index,code:r.Code??'Unknown',table:Object.values(operations[index]??{})[0]?.TableName})):[]});\n"+indent+"const recovered = prior(await strongGet(db, "+table+".holds, outcomeKey));");
}
function patch(source) {
 const pattern=/let items = JSON\.parse\(JSON\.stringify\((q4|q)\.TransactItems\)\);/g;
 if([...source.matchAll(pattern)].length!==1)throw Error('UNEXPECTED_ROLLOUT_TRANSPORT');
 return diagnostics(source.replace(pattern,'let items = structuredClone($1.TransactItems);'));
}
module.exports={patch,diagnostics};
if(require.main===module){const fs=require('node:fs');for(const name of ['index.js','finance-rollout.js','customer-cash-runtime-266.js']){
 const file='/private/tmp/financial-delivery-runtime/'+name;fs.writeFileSync(file,patch(fs.readFileSync(file,'utf8')));
}console.log('Patched final rollout transport; financial guards retained; failure diagnostics omit financial payloads');}
