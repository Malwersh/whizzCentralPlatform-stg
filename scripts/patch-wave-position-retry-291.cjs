'use strict';
const ts=require('../backend/wallet-service/node_modules/typescript');
function patch(source){
 const ast=ts.createSourceFile('host.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let found=[];
 function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='createStagingDriverFinancialWave')found.push(n);ts.forEachChild(n,walk);}walk(ast);if(found.length!==1)throw Error('Expected one financial wave factory');
 const f=found[0],body=f.getText(ast);if(body.includes('financial-delivery-position-retry-291'))return source;
 const start=body.indexOf('      const live = await context2.checkAcceptance('),end=body.indexOf('      const view = versionedFinancialOfferView(',start);if(start<0||end<0)throw Error('Unknown preflight shape');
 const old=body.slice(start,end);if(!old.includes('live.guards.deletions')||!old.includes('new import_lib_dynamodb9.TransactWriteCommand')||!old.includes('exactCheck(offers'))throw Error('Missing original safety guards');
 const replacement=`      /* financial-delivery-position-retry-291 */
      let live;
      for (let positionAttempt = 0; positionAttempt < 3; positionAttempt++) {
        live = await context2.checkAcceptance({ orderId, branchId, driverId, waveNumber, offerId: offer.offerId });
        if (live.subjectId !== offer.driverSubjectId || live.assignment.dispatchJobId !== wave2.assignmentId) return conflict();
        const preflight = [live.order.condition, ...(live.order.releaseCondition ? [live.order.releaseCondition] : []), ...Object.values(live.guards).filter(v => !Array.isArray(v)), ...live.guards.deletions, exactCheck(jobs, waveKey, wave2), exactCheck(offers, { orderId, SK: saved.SK }, saved)];
        const positionIndex = preflight.findIndex(op => op === live.guards.position);
        try { await db.send(new import_lib_dynamodb9.TransactWriteCommand({ TransactItems: preflight })); break; }
        catch (error) {
          const reasons = error?.CancellationReasons;
          const positionOnly = error?.name === 'TransactionCanceledException' && positionIndex >= 0 && Array.isArray(reasons) && reasons.length >= preflight.length && reasons[positionIndex]?.Code === 'ConditionalCheckFailed' && reasons.every((r, i) => i === positionIndex || r?.Code === 'None');
          if (!positionOnly || positionAttempt === 2) throw error;
        }
      }
      if (!live) return conflict();
`;
 const result=source.slice(0,f.getStart(ast)+start)+replacement+source.slice(f.getStart(ast)+end);if(ts.createSourceFile('candidate.js',result,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length)throw Error('Invalid patched JavaScript');return result;
}
module.exports={patch};
if(require.main===module){const fs=require('fs'),[input,output]=process.argv.slice(2);fs.writeFileSync(output,patch(fs.readFileSync(input,'utf8')));}
