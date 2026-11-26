'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHandler}=require('./customer-favorites.cjs');
const {identities:{customer}}=require('./wallet-identity-bindings.json');

const apiId='aaaaaaaaaa';
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const branch='business_favorite';
const list='/users/{user_id}/favorites';
const item=list+'/{favorite_id}';
const status=list+'/check/{business_id}';
const token=sub=>'header.'+Buffer.from(JSON.stringify({sub,iss:'https://cognito-idp.us-east-1.amazonaws.com/'+customer.poolId,
  client_id:customer.clientId,token_use:'access'})).toString('base64url')+'.signature';
const authError=()=>Object.assign(Error(),{name:'NotAuthorizedException'});
const cancelled=()=>Object.assign(Error(),{name:'TransactionCanceledException',CancellationReasons:[
  {Code:'None'},{Code:'None'},{Code:'ConditionalCheckFailed'},
]});
const fixture=({locked=false,isActive=true}={})=>{
  const rows=new Map(), queries=[], commands=[];
  const db={async send(command){
    const input=command.input;
    commands.push(input);
    if(command.constructor.name==='GetCommand'){
      if(input.TableName.endsWith('Customers')) return {Item:{userId:input.Key.userId,cognitoSub:input.Key.userId,isActive:true}};
      if(input.TableName.endsWith('Merchants')) return {Item:{businessId:branch,isActive,businessName:'مطعم معتمد',status:'APPROVED'}};
      if(input.TableName.endsWith('AccountDeletion'))return locked?{Item:{pk:'locked'}}:{};
      return {Item:rows.get(input.Key.favoriteId)};
    }
    if(command.constructor.name==='QueryCommand'){
      queries.push(input);
      const values=input.ExpressionAttributeValues;
      return {Items:[...rows.values()].filter(row=>row.userId===values[':owner'] && row.favoriteType===values[':type']
        && (!values[':business']||row.businessId===values[':business']))};
    }
    const [account, lifecycle, op]=input.TransactItems;
    assert.match(account.ConditionCheck.ConditionExpression,/cognitoSub/);
    assert.match(lifecycle.ConditionCheck.Key.pk,/ACCOUNT_LIFECYCLE#CUSTOMER#/);
    if(op.Put){
      const key=op.Put.Item.favoriteId;
      if(rows.has(key))throw cancelled();
      rows.set(key,op.Put.Item);
    } else {
      const key=op.Delete.Key.favoriteId;
      if(rows.has(key)&&rows.get(key).userId!==op.Delete.ExpressionAttributeValues[':owner'])throw cancelled();
      rows.delete(key);
    }
    return {};
  }};
  const handler=createHandler({db,apiId,now:()=>new Date('2026-11-24T21:00:00Z'),getUser:async value=>{
    if(value===token(owner)||value===token(other)){
      const {sub}=JSON.parse(Buffer.from(value.split('.')[1],'base64url').toString());
      return {Username:sub,UserAttributes:[{Name:'sub',Value:sub}]};
    }
    throw authError();
  }});
  function call(method='GET',resource=list,params={},opts={}){
    return handler({httpMethod:method,resource,requestContext:{apiId,stage:'production'},headers:{Authorization:'Bearer '+token(owner)},
      pathParameters:{user_id:owner,...params},...opts});
  }
  const add=()=>call('POST',list,{}, {body:JSON.stringify({businessId:branch,businessName:'اسم مزيف'})});
  return {rows,call,add,queries,commands};
}
const data=result=>JSON.parse(result.body).data;

test('a concurrent add creates one row and returns the canonical branch name and same favorite ID',async()=>{
  const f=fixture();
  const results=await Promise.all([f.add(),f.add()]);
  assert.deepEqual(results.map(x=>x.statusCode).sort(),[200,201]);
  assert.equal(f.rows.size,1);
  assert.equal(data(results[0]).id,data(results[1]).id);
  assert.equal(data(results[0]).business_name,'مطعم معتمد');
});

test('user listing and immediate check preserve the mobile contract and support a repeated remove',async()=>{
  const f=fixture();
  const favorite=data(await f.add());
  const second=await f.call('GET',status,{business_id:branch});
  assert.equal(data(second).favorite_id,favorite.id);
  assert.equal(data(await f.call()).favorites[0].business_id,branch);
  assert.equal((await f.call('DELETE',item,{favorite_id:favorite.id})).statusCode,200);
  assert.equal((await f.call('DELETE',item,{favorite_id:favorite.id})).statusCode,200);
  assert.equal(data(await f.call('GET',status,{business_id:branch})).is_favorite,false);
});

test('favorites can neither be read through another account path nor removed with another favorite ID',async()=>{
  const f=fixture();
  const own=data(await f.add());
  assert.equal((await f.call('GET',list,{user_id:other})).statusCode,403);
  const foreign=await f.call('DELETE',item,{favorite_id:own.id,user_id:other},{headers:{Authorization:'Bearer '+token(other)}});
  assert.equal(foreign.statusCode,200);
  const absent=await f.call('DELETE',item,{favorite_id:'fav_absent',user_id:other},{headers:{Authorization:'Bearer '+token(other)}});
  assert.equal(absent.body,foreign.body);
  assert.equal(f.rows.has(own.id),true);
  assert.equal((await f.call('GET',list,{}, {headers:{}})).statusCode,401);
});

test('existing legacy ID is still recognized without introducing a second row',async()=>{
  const f=fixture();
  const legacy={favoriteId:'fav_1790000000000_legacy',userId:owner,businessId:branch,favoriteType:'restaurant',businessName:'مطعم قديم'};
  f.rows.set(legacy.favoriteId,legacy);
  assert.equal(data(await f.add()).id,legacy.favoriteId);
  assert.equal(data(await f.call('GET',status,{business_id:branch})).favorite_id,legacy.favoriteId);
  assert.equal(f.rows.size,1);
});

test('production rejects suspended accounts and unpublished branches before writes',async()=>{
  const locked=fixture({locked:true});
  assert.equal((await locked.add()).statusCode,403);
  assert.equal(locked.queries.length,0);
  const inactive=fixture({isActive:false});
  assert.equal((await inactive.add()).statusCode,404);
  assert.equal(inactive.rows.size,0);
});
