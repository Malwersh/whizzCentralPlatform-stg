'use strict';
const ROLES={
 staff_manager:['staff.read','staff.invite','staff.change.request'],
 staff_approver:['staff.read','staff.change.approve'],
 customer_service:['support.read','support.reply','customers.read','orders.read'],
 support_supervisor:['support.read','support.reply','support.assign','support.close','support.metrics','customers.read','orders.read'],
 driver_manager:['drivers.read','drivers.edit','orders.read'],
 driver_reviewer:['drivers.read','drivers.documents.read','drivers.review','drivers.suspend'],
 merchant_manager:['merchants.read','merchants.edit','products.read','products.edit'],
 merchant_reviewer:['merchants.read','merchants.documents.read','merchants.review','merchants.suspend'],
 operations:['orders.read','orders.assign','orders.cancel','drivers.read','merchants.read'],
 region_manager:['regions.read','regions.edit','regions.activate'],
 promotions_manager:['promotions.read','promotions.create','promotions.edit'],
 promotions_approver:['promotions.read','promotions.approve'],
 finance_viewer:['finance.read'],
 finance_operator:['finance.read','finance.request','finance.topup.review'],
 finance_approver:['finance.read','finance.approve'],
 finance_settings:['finance.read','finance.settings.request'],
 finance_settings_approver:['finance.read','finance.settings.approve'],
 auditor:['audit.read','reports.read','audit.export'],
 platform_manager:['dashboard.read','reports.read','drivers.read','merchants.read','customers.read','orders.read','regions.read','promotions.read','staff.read']
};
const LABELS={staff_manager:'إدارة الموظفين',staff_approver:'اعتماد الصلاحيات',customer_service:'خدمة العملاء',support_supervisor:'مشرف الدعم',driver_manager:'إدارة السائقين',driver_reviewer:'مراجعة السائقين',merchant_manager:'إدارة المتاجر',merchant_reviewer:'مراجعة المتاجر',operations:'تشغيل الطلبات',region_manager:'إدارة المناطق',promotions_manager:'إدارة العروض',promotions_approver:'اعتماد العروض',finance_viewer:'مشاهد مالي',finance_operator:'عمليات مالية',finance_approver:'اعتماد مالي',finance_settings:'اقتراح إعدادات مالية',finance_settings_approver:'اعتماد إعدادات مالية',auditor:'مدقق',platform_manager:'إشراف المنصة'};
ROLES.bootstrap_admin=[...new Set(Object.values(ROLES).flat())];LABELS.bootstrap_admin='مدير التأسيس الحالي';
function effective(employee){if(!employee || employee.status!=='ACTIVE')return [];return [...new Set((employee.roles||[]).flatMap(role=>Object.hasOwn(ROLES,role)?ROLES[role]:[]))];}
function allowed(employee,permission,regionId){if(!effective(employee).includes(permission))return false;if(regionId===undefined)return true;return employee.scope?.allRegions===true || (typeof regionId==='string' && employee.scope?.regionIds?.includes(regionId));}
function validateAssignment(input){
 if(!Array.isArray(input.roles)||input.roles.length<1||input.roles.length>10||input.roles.some(r=>!Object.hasOwn(ROLES,r)||r==='bootstrap_admin'))throw Error('INVALID_ROLES');
 if(!['ACTIVE','SUSPENDED'].includes(input.status))throw Error('INVALID_STATUS');
 if(!input.scope || typeof input.scope.allRegions!=='boolean' || !Array.isArray(input.scope.regionIds) || input.scope.regionIds.length>100 || input.scope.regionIds.some(r=>typeof r!=='string'||r.length<1||r.length>100))throw Error('INVALID_SCOPE');
 if(!input.scope.allRegions && input.scope.regionIds.length===0)throw Error('REGION_SCOPE_REQUIRED');
 if(!Number.isSafeInteger(input.approvalLimit)||input.approvalLimit<0||input.approvalLimit>1000000000)throw Error('INVALID_APPROVAL_LIMIT');
 if(input.roles.some(r=>['staff_manager','staff_approver','finance_viewer','finance_operator','finance_approver','finance_settings','finance_settings_approver','auditor'].includes(r))&&!input.scope.allRegions)throw Error('GLOBAL_ROLE_REQUIRES_GLOBAL_SCOPE');
 return {roles:[...new Set(input.roles)],status:input.status,scope:{allRegions:input.scope.allRegions,regionIds:[...new Set(input.scope.regionIds)]},approvalLimit:input.approvalLimit};
}
module.exports={ROLES,LABELS,effective,allowed,validateAssignment};
