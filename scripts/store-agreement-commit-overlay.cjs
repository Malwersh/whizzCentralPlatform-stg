'use strict';
// The bundled handler renames locals; derive the authenticated customer binding
// from its existing reservation check rather than assuming its source name.
function customerExpression(predicate) {
 const matches=[...predicate.matchAll(/reservation\.customerId\s*!==\s*([A-Za-z_$][\w$]*\.userId)\b/g)];
 if(matches.length!==1)throw Error('CUSTOMER_BINDING_ANCHOR');
 return matches[0][1];
}
function agreementPredicate(predicate,relative) {
 const customer=customerExpression(predicate);
 return `deliveryFunding.allocation.schemaVersion===2 ? !require(${JSON.stringify(relative)}).hasStoreAgreementOrderEvidence(operations,deliveryFunding,orderId,${customer}) : (${predicate})`;
}
module.exports={customerExpression,agreementPredicate};
