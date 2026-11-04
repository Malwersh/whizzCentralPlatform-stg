'use strict';
// Local authorization contract; wire only after live memberships/device sessions exist.
const {authorize,permissions}=require('./domain');
const fail=code=>{throw Object.assign(Error(code),{code});};
const OPTIONAL=['branch.description.write','branch.photo.write','branch.instructions.write','branch.phone.change','staff.manage'];
const OWNER_ONLY=['branch.name.request','branch.location.request','branch.setup.complete','business.close','ownership.transfer','settlements.manage'];
function capabilities(context){
 authorize({...context,permission:'branch.read'});
 const m=context.membership;
 const owner=m.role==='OWNER',granted=permissions(m,context.policy,context.registry,context.branchId);
 if(m.permissionSchema===2)return {read:true,readSettlements:granted.includes('wallet.settlements.read'),requestPayout:granted.includes('finance.payout.request'),receivePayout:granted.includes('finance.payout.receive'),transferFunds:granted.includes('finance.transfer'),readDiscounts:granted.includes('discounts.read'),createDiscounts:granted.includes('discounts.create'),editDiscounts:granted.includes('discounts.edit'),activateDiscounts:granted.includes('discounts.activate'),deleteDiscounts:granted.includes('discounts.delete'),editStatus:granted.includes('branch.status.write'),readWalletBalance:granted.includes('wallet.balance.read'),readWalletTransactions:granted.includes('wallet.transactions.read'),exportWallet:granted.includes('wallet.export'),readSalesReports:granted.includes('reports.sales.read'),exportSalesReports:granted.includes('reports.export')&&granted.includes('reports.sales.read'),readOrders:granted.includes('orders.read'),readMenu:granted.includes('menu.read'),createProduct:granted.includes('menu.create'),deleteProduct:granted.includes('menu.delete'),readHours:granted.includes('hours.read'),editProductInfo:granted.includes('menu.edit'),editProductPrice:granted.includes('menu.price.write'),editProductAvailability:granted.includes('menu.availability.write'),editMenu:['menu.edit','menu.price.write','menu.availability.write'].some(p=>granted.includes(p)),editHours:granted.includes('hours.write'),editDescription:false,editPhoto:false,editInstructions:false,changePhone:false,requestName:false,requestLocation:false,completeSetup:false,close:false,manageStaff:false};
 return {
  read:true,
  editMenu:granted.includes('menu.write'),
  editHours:granted.includes('branch.hours.write'),
  editDescription:owner||(m.extraPermissions||[]).includes('branch.description.write'),
  editPhoto:owner||(m.extraPermissions||[]).includes('branch.photo.write'),
  editInstructions:owner||(m.extraPermissions||[]).includes('branch.instructions.write'),
  changePhone:owner||(m.extraPermissions||[]).includes('branch.phone.change'),
  requestName:owner,requestLocation:owner,completeSetup:owner,close:owner,
  manageStaff:owner||(m.extraPermissions||[]).includes('staff.manage'),
 };
}
function view(branch,context){
 if(!branch||branch.businessId!==context.branchId||branch.deletionRequestId)fail('BRANCH_UNAVAILABLE');
 const rights=capabilities(context);
 // Explicit public operational projection: never return owner identity, documents,
 // settlement fields, person email, tokens or an arbitrary future database field.
 const fields=['businessId','businessName','name','businessTypeId','businessType','businessTypeLabelAr','description','website','businessPhotoUrl','phoneNumber','address','regionId','regionPath','status','reviewStatus','isActive','acceptingOrders','operatingStatus','platformSuspended','updatedAt'];
 return {business:Object.fromEntries(fields.filter(k=>branch[k]!==undefined).map(k=>[k,branch[k]])),capabilities:rights};
}
function assertAction(context,action){
 const c=capabilities(context);
 const keys={description:'editDescription',photo:'editPhoto',instructions:'editInstructions',phone:'changePhone',name:'requestName',location:'requestLocation',hours:'editHours',menu:'editMenu',staff:'manageStaff',completeSetup:'completeSetup',close:'close'};
 if(!keys[action]||!c[keys[action]])fail('PERMISSION_REQUIRED');
 return true;
}
function assertOptionalGrant(permission){if(!OPTIONAL.includes(permission)||OWNER_ONLY.includes(permission))fail('NON_DELEGABLE_PERMISSION');return true;}
module.exports={capabilities,view,assertAction,assertOptionalGrant};
