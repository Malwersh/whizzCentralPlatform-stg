import {createHash} from 'node:crypto';
type Row=Record<string,any>;
export const auditText=(v:any)=>typeof v==='string'?(/\bBearer\s+|X-Amz-(Signature|Credential|Security-Token)=|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./i.test(v)?'[محجوب]':v.length>1000?'[LONG_TEXT_SHA256:'+createHash('sha256').update(v).digest('hex')+';LENGTH:'+v.length+']':v):null;
export function auditActor(id:string,staff?:Row){
 const verified=staff?.employeeId===id;
 return {actorId:id,actorIdentityEvidence:verified?'VERIFIED_STAFF_AT_ACTION':'ID_ONLY',actorSnapshot:verified?{employeeId:id,name:auditText(staff.name||staff.displayName),version:staff.version,roles:[...(staff.roles||[])],scope:staff.scope?JSON.parse(JSON.stringify(staff.scope)):null}:null};
}
export function walletAuditState(w:Row,credit=0){
 const out:Row={walletId:w.walletId};for(const k of ['availableBalance','lockedBalance','version','status'])if(w[k]!==undefined)out[k]=w[k];
 if(credit!==0){out.availableBalance=w.availableBalance+credit;out.version=w.version+1;}return out;
}
export function financialAudit(actorId:string,staff:Row|undefined,before:Row|null,after:Row,references:Row,reason?:string){
 return {auditSchemaVersion:2,...auditActor(actorId,staff),before,after,references,reason:auditText(reason),outcome:'RECORDED'};
}

export function driverAuditActor(id:string,profile:Row){return {actorId:id,actorIdentityEvidence:'VERIFIED_DRIVER_AT_ACTION',actorSnapshot:{driverId:id,name:auditText(profile.name||profile.fullName),...(profile.version!==undefined?{version:profile.version}:{})}};}
