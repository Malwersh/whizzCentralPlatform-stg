'use strict';
const fs=require('node:fs'),path=require('node:path'),p='/private/tmp/registry-259',policy=require('../backend/staff-service/merchant-staff-policy'),{rolePresets}=policy;
const before=JSON.parse(fs.readFileSync(p+'/policy-before.json')),presets=require('../backend/staff-service/staff-capabilities').rolePresets(),ids=['wallet.settlements.read','reports.finance.read','finance.payout.request','finance.payout.receive'];
const roles=before.roles.map(r=>{if(!['BRANCH_MANAGER','FINANCIAL_EMPLOYEE'].includes(r.id))return r;const {pendingPermissions,...preset}=presets.find(p=>p.id===r.id);return {...preset,version:r.version+1};});
const values={roles,enabledPermissions:[...new Set([...before.enabledPermissions,...ids])]},next=policy.validate(values,before);fs.writeFileSync(p+'/policy-next.json',JSON.stringify(next,null,2)+'\n');console.log('Validated policy',next.version,'roles',next.roles.map(r=>[r.id,r.enabled,r.version]));
