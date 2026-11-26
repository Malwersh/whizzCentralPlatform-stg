'use strict';
const fs=require('fs'),assert=require('assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
let s=fs.readFileSync('/private/tmp/finance92/financial-runtime.base.js','utf8');
const source=fs.readFileSync('backend/wallet-service/dist/driverOfferOrderReader.js','utf8');
const ast=ts.createSourceFile('reader.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const helper=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='driverOfferDisplay').getText(ast);
assert(!s.includes('function driverOfferDisplay('));
function patchOnce(before,after){assert.equal(s.split(before).length,2,before);s=s.replace(before,after);}
const start=s.indexOf('function createStagingDriverOfferOrderReader(');assert(start>0);
s=s.slice(0,start)+helper+'\n'+s.slice(start);
patchOnce('"cancellationRequestId"\n];','"cancellationRequestId", "items", "storeName", "storeImage", "storeAddress"\n];');
patchOnce('return copy2({ priorRelease, releaseCondition, nextAssignmentAttempt:', 'return copy2({ display: driverOfferDisplay(saved), priorRelease, releaseCondition, nextAssignmentAttempt:');
patchOnce('offer: view2 });','offer: { ...view2, ...(live.order.display ? {display: live.order.display} : {}) } });');
fs.writeFileSync('/private/tmp/finance92/financial-runtime.js',s);
const vm=require('vm'),order=JSON.parse(fs.readFileSync('/private/tmp/finance91/canary-order.private.json'));
const display=vm.runInNewContext(helper+';driverOfferDisplay')(order);
assert.equal(display.totalQuantity,2);assert.equal(display.items[0].unitPrice.minorAmount,3500000);assert.equal(display.restaurant.name,'مطعم فتوش');
assert(!JSON.stringify(display).includes(order.customerPhone));
console.log(JSON.stringify({overlayVerified:true,quantity:display.totalQuantity,unitPriceIqd:display.items[0].unitPrice.minorAmount/1000,customerIdentityExcluded:true}));
