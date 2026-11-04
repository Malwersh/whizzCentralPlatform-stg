'use strict';
// One cancellation planner shared by financial pending-response and legacy Order Service.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'backend/wallet-service/src/offerUsageRelease.ts'));
const destination=path.join(root,'backend/order-service/src/offerUsageRelease.ts');
if(process.argv.includes('--check')){
 if(!source.equals(fs.readFileSync(destination)))throw Error('OFFER_USAGE_RELEASE_DRIFT');
}else fs.writeFileSync(destination,source);
