const test=require('node:test'),assert=require('node:assert/strict');
const {setup}=require('./helpers/driver-financial-fixture.cjs');
const m=require('../../shared/driver-vehicles-308');
function ready(type='car'){const f=setup('3000');const p=f.get('WhizzDrivers_staging',{driverId:'driver1'});
 Object.assign(p,{vehicleType:type,vehiclePlate:'308',work_region_id:'zone1',registrationPaperUrl:'s3://bucket/drivers/driver1/registration',drivingLicenseUrl:'s3://bucket/drivers/driver1/license',nationalIdUrl:'s3://bucket/drivers/driver1/id'});
 const review=documentUrl=>({status:'APPROVED',documentUrl,reviewedBy:'admin',reviewedAt:new Date(f.time).toISOString(),expiresAt:'2027-01-01T21:00:00.000Z',reason:'verified'});
 const v={id:'vehicle',type,plateNumber:'308',make:'',model:'',color:'',registrationUrl:p.registrationPaperUrl};v.review={...review(v.registrationUrl),fingerprint:m.fingerprint(v)};
 p.vehicleRegistry={schemaVersion:1,version:1,activeId:v.id,items:{vehicle:v},events:[]};p.vehicleOperational=p.vehicleRegistry;p.personalDocumentReview={drivingLicense:review(p.drivingLicenseUrl),nationalId:review(p.nationalIdUrl)};
 return {f,p};}
test('vehicle snapshot is frozen on accepted order and persists after later profile changes',async()=>{const {f,p}=ready();await f.run(['driver1']);await f.accept();const o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});assert.equal(o.driverVehicleSnapshot.id,'vehicle');assert.equal(o.driverVehicleSnapshot.plateNumber,'308');p.vehiclePlate='later';assert.equal(o.driverVehicleSnapshot.plateNumber,'308');});
test('a different approved vehicle of the same type cannot take over an old pending offer',async()=>{const {f,p}=ready();await f.run(['driver1']);const old=p.vehicleRegistry.items.vehicle;const next={...structuredClone(old),id:'new',plateNumber:'different'};next.review.fingerprint=m.fingerprint(next);p.vehicleRegistry.items.new=next;p.vehicleRegistry.activeId='new';p.vehiclePlate='different';await assert.rejects(f.accept(),/CONFLICT/);assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).driverId,undefined);});
test('document review revoked after offer delivery prevents acceptance without a hold',async()=>{const {f,p}=ready();await f.run(['driver1']);p.personalDocumentReview.drivingLicense.status='REJECTED';await assert.rejects(f.accept(),/DRIVER_UNAVAILABLE/);assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}),undefined);});

for(const type of ['car','motorcycle']) {
 test(`ordinary launch delivery permits the approved active ${type} and freezes it on acceptance`,async()=>{
  const {f,p}=ready(type);assert.equal(m.eligibility(p,f.time).eligible,true);
  await f.run(['driver1']);await f.accept();
  const o=f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'});
  assert.equal(o.driverVehicleSnapshot.type,type);assert.equal(o.vehicleType,type);
 });
 test(`expired ${type} registration before issuance cannot create an offer`,async()=>{
  const {f,p}=ready(type);p.vehicleRegistry.items.vehicle.review.expiresAt=new Date(f.time).toISOString();
  assert.equal(m.eligibility(p,f.time).eligible,false);
  await assert.rejects(f.run(['driver1']),/DRIVER_UNAVAILABLE/);assert.equal(f.sent.length,0);
 });
 test(`expiry between issuance and acceptance of ${type} cannot reserve a wallet hold`,async()=>{
  const {f,p}=ready(type);await f.run(['driver1']);
  p.personalDocumentReview.drivingLicense.expiresAt=new Date(f.time).toISOString();
  await assert.rejects(f.accept(),/DRIVER_UNAVAILABLE/);
  assert.equal(f.get('staging-Holds',{orderId:'order1',sk:'HOLD'}),undefined);
 });
}
test('unknown vehicle type cannot use an approved-looking registry for ordinary delivery',()=>{
 const {f,p}=ready('truck');assert.equal(m.eligibility(p,f.time).eligible,false);
});
