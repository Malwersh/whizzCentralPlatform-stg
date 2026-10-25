'use strict';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(v);
function ratingChronology(record){
 if(!record||!id(record.orderId)||!id(record.driverId)||!Number.isInteger(record.driverStars)||record.driverStars<1||record.driverStars>5||typeof record.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(record.createdAt)||!Number.isFinite(Date.parse(record.createdAt)))return null;
 return {driverRatingKey:'DRIVER#'+record.driverId,driverRatingSort:new Date(record.createdAt).toISOString()+'#'+record.orderId};
}
module.exports={ratingChronology};
