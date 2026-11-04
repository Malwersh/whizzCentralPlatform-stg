'use strict';
const {readSnapshot,validId}=require('./contract');
async function read({db,GetCommand,driverId,driversTable,inScope}){
 if(!validId(driverId)||typeof inScope!=='function')throw Object.assign(Error('DRIVER_UNAVAILABLE'),{status:404});
 const profile=(await db.send(new GetCommand({TableName:driversTable,Key:{driverId},ConsistentRead:true}))).Item;
 if(!profile||!inScope(profile))throw Object.assign(Error('DRIVER_UNAVAILABLE'),{status:404});
 return readSnapshot({db,GetCommand,driverId});
}
module.exports={read};
