import {directOperator} from './writeWorkflow';
import roles from './staff-roles.json';
import {docClient,GetCommand} from './db';
import {fundingError} from './fundingService';
export async function financialStaff(id:string,permission:string|string[]){
 const table=process.env.STAFF_TABLE;
 if(!table)return undefined;
 const {Item}=await docClient.send(new GetCommand({TableName:table,Key:{pk:'EMPLOYEE#'+id,sk:'PROFILE'},ConsistentRead:true}));
 const permissions=(directOperator(id)&&Item?.status==='ACTIVE'?Object.keys(roles):Item?.roles||[]).flatMap((role:string)=>Object.prototype.hasOwnProperty.call(roles,role)?(roles as Record<string,string[]>)[role]:[]);
 if(!Item||Item.status!=='ACTIVE'||!(Array.isArray(permission)?permission:[permission]).some(p=>permissions.includes(p))||Item.scope?.allRegions!==true)throw fundingError('صلاحيات الموظف غير كافية أو الحساب موقوف','STAFF_PERMISSION_REQUIRED',403);
 return Item;
}
export function staffGuard(employee:any){return {ConditionCheck:{TableName:process.env.STAFF_TABLE,Key:{pk:employee.pk,sk:'PROFILE'},ConditionExpression:'#v = :v AND #s = :active',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':employee.version,':active':'ACTIVE'}}};}
export function approvalAmount(employee:any,amount:number){if(employee&&!employee.roles.includes('bootstrap_admin')&&(!Number.isSafeInteger(employee.approvalLimit)||amount>employee.approvalLimit))throw fundingError('المبلغ يتجاوز سقف اعتماد الموظف','STAFF_APPROVAL_LIMIT',403);}
