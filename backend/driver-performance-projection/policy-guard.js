'use strict';
const {TABLE,POLICY}=require('./contract');
async function assertCutoverReady({db,GetCommand,values,now=()=>Date.now()}){
 if(values?.dispatch?.performanceMode!=='VERIFIED_SNAPSHOT_V1')return;
 const read=async sk=>(await db.send(new GetCommand({TableName:TABLE,Key:{pk:'CONTROL',sk},ConsistentRead:true}))).Item;
 const [proof,health]=await Promise.all([read('DISPATCH_READY'),read('HEALTH')]);
 if(proof?.policyVersion!==POLICY||proof?.ready!==true||proof?.persistedParityPassed!==true||proof?.shadowPassed!==true||proof?.policyReadersCompatible!==true||health?.healthy!==true||!Number.isFinite(Date.parse(health.updatedAt))||now()-Date.parse(health.updatedAt)>180000)throw Object.assign(Error('DRIVER_PERFORMANCE_NOT_READY'),{status:409});
}
module.exports={assertCutoverReady};
