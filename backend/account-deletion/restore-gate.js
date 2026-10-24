'use strict';
const {error}=require('./policy');
// The authoritative journal is always the CURRENT live journal, never a restored copy.
function manifest(requests,staff){
 const identities=new Set(),businesses=new Set(),memberships=[];
 for(const r of requests){
  if(r.status!=='COMPLETED')continue;
  if(r.scope?.kind==='MEMBERSHIP'){memberships.push({subject:r.subjectId,business:r.scope.id,completedAt:r.updatedAt});continue;}
  if(r.scope?.kind==='BUSINESS')businesses.add(r.scope.id);
  else if(r.scope?.kind==='ACCOUNT'){identities.add(r.subjectId);for(const id of r.restoreManifest?.profileIds||[])identities.add(id);}
 }
 for(const s of staff)if(s.status==='DELETED')identities.add(s.employeeId);
 return {identities,businesses,memberships};
}
function assertQuarantine(name){if(typeof name!=='string'||!/^RESTORE_QUARANTINE_staging_[a-zA-Z0-9_-]+$/.test(name))throw error('RESTORE_QUARANTINE_REQUIRED');}
function contains(value,set){if(typeof value==='string')return set.has(value);if(Array.isArray(value))return value.some(v=>contains(v,set));if(value&&typeof value==='object')return Object.values(value).some(v=>contains(v,set));return false;}
function gate({table,rows,journal,staff=[]}){
 assertQuarantine(table);
 const legacy=journal.some(r=>r.status==='COMPLETED'&&r.scope?.kind==='ACCOUNT'&&!r.restoreManifest);
 const m=manifest(journal,staff);let blocked=0,legacyBlocked=false;
 function ambiguous(v){if(Array.isArray(v))return v.some(ambiguous);if(!v||typeof v!=='object')return false;if(['userId','driverId','walletId','phone','phoneNumber','email','username'].some(k=>typeof v[k]==='string')&&!v.cognitoSub&&!v.sub)return true;return Object.values(v).some(ambiguous);}
 for(const row of rows){
  // A financial reference may legitimately survive. This gate deliberately fails closed:
  // the operator must restore an already sanitized financial record instead of publishing it blindly.
  if(contains(row,m.identities)||contains(row,m.businesses)){blocked++;continue;}
  if(legacy&&ambiguous(row)){blocked++;legacyBlocked=true;continue;}
  for(const member of m.memberships){
   if(!contains(row,new Set([member.subject]))||!contains(row,new Set([member.business])))continue;
   const created=new Date(row.createdAt||row.grantedAt).getTime(),completed=new Date(member.completedAt).getTime();
   if(!Number.isFinite(created)||!Number.isFinite(completed)||created<=completed){blocked++;break;}
  }
 }
 return {passed:blocked===0,blocked,rows:rows.length,...(legacyBlocked?{reason:'LEGACY_RESTORE_MANIFEST_REQUIRED'}:{})};
}
module.exports={manifest,assertQuarantine,gate};
