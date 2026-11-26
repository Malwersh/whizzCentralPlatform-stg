'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const routes=require('../backend/staff-service/settlement-schedules');
const ctx={enabled:true,db:{send(){throw Error('NO_DATABASE_ACCESS_EXPECTED');}},claims:{auth_time:Math.floor(Date.now()/1000)},enrolled:true};
const actor={employeeId:'11111111-1111-4111-8111-111111111111'};
test('staff collection endpoints reach strict validators before touching metadata for malformed bodies',async()=>{
 for(const view of ['period-collection','period-collection-parts'])await assert.rejects(routes.staff(ctx,actor,'GET',{view}),/SETTLEMENT_COLLECTION_INVALID/);
 for(const action of ['START_PERIOD_COLLECTION','ADVANCE_PERIOD_COLLECTION','FREEZE_PERIOD_COLLECTION'])await assert.rejects(routes.staff(ctx,actor,'POST',{action,branchId:'branch',orderIds:['injected'],actorId:'forged'}),/SETTLEMENT_COLLECTION_INVALID/);
});
test('new collection actions remain unavailable when staff service is disabled',async()=>{await assert.rejects(routes.staff({...ctx,enabled:false},actor,'POST',{action:'START_PERIOD_COLLECTION'}),/SETTLEMENT_SCHEDULE_ADMIN_DISABLED/);});
