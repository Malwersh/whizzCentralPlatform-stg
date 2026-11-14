const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepare}=require('../../../scripts/prepare-delivery-funding-access-149.cjs');
const base={function:'customer',role:'arn:aws:iam::699561669180:role/test',resource:'arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff',leadingKey:'DELIVERY_BUDGET#review',action:'dynamodb:PutItem',decision:'implicitDeny',missingContext:[]};
test('permission delta includes denied campaign actions only and requires explicit leading keys',()=>{
 const rows=prepare([base,{...base,leadingKey:'DELIVERY_USAGE#review'},{...base,action:'dynamodb:GetItem',decision:'allowed'}]);assert.equal(rows.length,1);
 const s=rows[0].policy.Statement;assert.equal(s.length,1);assert.deepEqual(s[0].Action,['dynamodb:PutItem']);assert.deepEqual(s[0].Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'],['DELIVERY_BUDGET#*','DELIVERY_USAGE#*']);assert.equal(s[0].Condition.Null['dynamodb:LeadingKeys'],'false');assert.ok(!JSON.stringify(rows).includes('Wallets'));
});
test('unknown or denied boundary, incomplete simulation and new noncampaign authority stop preparation',()=>{
 for(const patch of [{error:'THROTTLED'},{missingContext:['context']},{decision:'explicitDeny'},{permissionsBoundary:{AllowedByPermissionsBoundary:false}},{resource:'arn:aws:dynamodb:us-east-1:699561669180:table/staging-Wallets'},{leadingKey:'EMPLOYEE#review'},{action:'dynamodb:DeleteItem'}])assert.throws(()=>prepare([{...base,...patch}]));
});
