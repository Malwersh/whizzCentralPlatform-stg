'use strict';

function branchAccess(rows,now){
 const active=new Map();
 const currentUntil=expiresAt=>!Number.isSafeInteger(expiresAt)||expiresAt>Math.floor(now/1000);
 function mark(code){active.set(code,(active.get(code)||0)+1);}
 for(const row of rows){
  const kind=row.sk;
  if(typeof kind!=='string')continue;
  if(kind.startsWith('MEMBER#')&&row.status==='ACTIVE')mark('ACTIVE_MEMBERSHIPS');
  if(kind.startsWith('DEVICE#')&&row.status==='ACTIVE'&&currentUntil(row.expiresAt))mark('ACTIVE_DEVICES');
  if(kind.startsWith('INVITE#')&&row.status==='PENDING'&&currentUntil(row.expiresAt))mark('PENDING_STAFF_INVITATIONS');
  if(kind==='PAIRING'&&row.status==='PENDING'&&currentUntil(row.expiresAt))mark('PENDING_DEVICE_PAIRING');
 }
 return [...active].map(([code,count])=>({code,count}));
}

module.exports={branchAccess};
