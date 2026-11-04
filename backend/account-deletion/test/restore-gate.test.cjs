const test=require('node:test'),assert=require('node:assert/strict');const {gate}=require('../restore-gate');
const table='RESTORE_QUARANTINE_staging_customer',journal=[{status:'COMPLETED',subjectId:'deleted',actorType:'CUSTOMER',scope:{kind:'ACCOUNT'},restoreManifest:{profileIds:['legacy-profile']}}];
test('restored deleted identity and legacy alias prevent promotion',()=>{for(const row of [{userId:'deleted'},{userId:'legacy-profile'},{cognitoSub:'deleted'}])assert.equal(gate({table,rows:[row],journal}).passed,false);});
test('new identity using same telephone is independent',()=>assert.equal(gate({table,rows:[{userId:'new',phone:'07800868280'}],journal}).passed,true));
test('live tables can never be mutated through restore workflow',()=>assert.throws(()=>gate({table:'WizzUser_users_staging',rows:[],journal}),/QUARANTINE/));
test('deleted branch prevents restoring its products',()=>assert.equal(gate({table,rows:[{businessId:'closed'}],journal:[{status:'COMPLETED',scope:{kind:'BUSINESS',id:'closed'}}]}).passed,false));
test('old membership cannot be restored but deliberate later regrant may survive',()=>{const j=[{status:'COMPLETED',subjectId:'member',scope:{kind:'MEMBERSHIP',id:'branch'},updatedAt:'2026-10-14T10:00:00Z'}];for(const date of [undefined,'2026-10-14T09:00:00Z'])assert.equal(gate({table,rows:[{memberId:'member',businessId:'branch',createdAt:date}],journal:j}).passed,false);assert.equal(gate({table,rows:[{memberId:'member',businessId:'branch',createdAt:'2026-10-14T11:00:00Z'}],journal:j}).passed,true);});
test('deleted staff profile cannot reappear from old backup',()=>assert.equal(gate({table,rows:[{employeeId:'former'}],journal:[],staff:[{employeeId:'former',status:'DELETED'}]}).passed,false));

test('older completed deletion without durable aliases blocks restore instead of guessing',()=>assert.equal(gate({table,rows:[{userId:'unknown-legacy'}],journal:[{status:'COMPLETED',scope:{kind:'ACCOUNT'},subjectId:'deleted'}]}).reason,'LEGACY_RESTORE_MANIFEST_REQUIRED'));

test('phone-only historical auth data without identity binding is quarantined',()=>assert.equal(gate({table,rows:[{phone:'old-number',digest:'old-proof'}],journal:[{status:'COMPLETED',scope:{kind:'ACCOUNT'},subjectId:'deleted'}]}).passed,false));
