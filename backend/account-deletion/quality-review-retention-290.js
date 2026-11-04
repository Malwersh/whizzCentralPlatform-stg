'use strict';
// No approved retention policy exists for these nonfinancial case records.
// Do not reuse the financial retention duration or delete/anonymize evidence silently.
function pendingQualityReviews(rows,driverIds){
 if(!Array.isArray(driverIds)||!driverIds.length)return [];
 return rows.filter(r=>r.kind==='DRIVER_QUALITY_REVIEW'&&driverIds.includes(r.driverId)).map(r=>({orderId:r.orderId,operationId:r.caseId,status:r.state==='RESOLVED'?'QUALITY_RETENTION_POLICY_REQUIRED':'QUALITY_REVIEW_OPEN'}));
}
module.exports={pendingQualityReviews};
