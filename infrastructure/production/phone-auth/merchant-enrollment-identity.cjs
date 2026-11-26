'use strict';
const crypto=require('node:crypto');
const {POOL}=require('./merchant-enrollment.cjs');
const {TABLE}=require('./merchant-enrollment-store.cjs');
const fail=()=>{throw Object.assign(Error('ACCOUNT_RECOVERY_REQUIRED'),{code:'ACCOUNT_RECOVERY_REQUIRED'});};
const attrs=u=>Object.fromEntries((u?.Attributes||u?.UserAttributes||[]).map(a=>[a.Name,a.Value]));
function createIdentity({db,cognito,GetCommand,PutCommand,UpdateCommand,ListUsersCommand,AdminCreateUserCommand,AdminGetUserCommand,AdminSetUserPasswordCommand,assertIdentityOpen,now=()=>Math.floor(Date.now()/1000)}){
 const find=async phone=>{
  const r=await cognito.send(new ListUsersCommand({UserPoolId:POOL,Filter:`phone_number = "${phone}"`,Limit:2}));
  if(r.PaginationToken||!Array.isArray(r.Users)||r.Users.length>1)fail();
  return r.Users[0];
 };
 const markerId=phone=>'ENROLL_PROVISION#'+POOL+'#'+phone;
 const marker=async phone=>(await db.send(new GetCommand({TableName:TABLE,Key:{id:markerId(phone)},ConsistentRead:true}))).Item;
 async function validate(user,phone,allowPending){
  const a=attrs(user);
  if(!user.Enabled||a.phone_number!==phone||a.phone_number_verified!=='true'||!a.sub)fail();
  await assertIdentityOpen(a.sub);
  if(user.UserStatus==='CONFIRMED')return;
  if(allowPending&&user.UserStatus==='FORCE_CHANGE_PASSWORD'){
   const m=await marker(phone);
   if(m?.poolId===POOL&&m.username===user.Username&&m.sub===a.sub&&m.phone===phone&&m.state==='CREATED')return;
  }
  fail();
 }
 return {
  async assertPhoneAvailable(phone){const u=await find(phone);if(u)await validate(u,phone,true);},
  async provisionVerified({phone,name,challengeId}){
   let user=await find(phone);
   if(!user){
    // One private marker wins account creation. A crash before saving Cognito's
    // generated subject deliberately requires recovery; no unrelated password is reset.
    try{await db.send(new PutCommand({TableName:TABLE,Item:{id:markerId(phone),poolId:POOL,phone,challengeId,state:'CREATING',createdAt:now()},ConditionExpression:'attribute_not_exists(id)'}));}
    catch(e){if(e.name!=='ConditionalCheckFailedException')throw e;fail();}
    const r=await cognito.send(new AdminCreateUserCommand({UserPoolId:POOL,Username:phone,MessageAction:'SUPPRESS',TemporaryPassword:'Aa1!'+crypto.randomBytes(48).toString('hex'),UserAttributes:[{Name:'phone_number',Value:phone},{Name:'phone_number_verified',Value:'true'},{Name:'name',Value:name}]}));
    user=r.User;const a=attrs(user);
    if(!user?.Username||!a.sub||a.phone_number!==phone)fail();
    await db.send(new UpdateCommand({TableName:TABLE,Key:{id:markerId(phone)},UpdateExpression:'SET username = :u, sub = :sub, #s = :created',ConditionExpression:'poolId = :pool AND phone = :phone AND challengeId = :challenge AND #s = :creating',ExpressionAttributeNames:{'#s':'state'},ExpressionAttributeValues:{':u':user.Username,':sub':a.sub,':created':'CREATED',':pool':POOL,':phone':phone,':challenge':challengeId,':creating':'CREATING'}}));
   }
   // Re-read the live account before issuing anything. Existing confirmed users
   // never have their name, phone, password or other attributes overwritten.
   user=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:user.Username}));
   await validate(user,phone,true);
   if(user.UserStatus==='FORCE_CHANGE_PASSWORD'){
    await cognito.send(new AdminSetUserPasswordCommand({UserPoolId:POOL,Username:user.Username,Password:'Aa1!'+crypto.randomBytes(48).toString('hex'),Permanent:true}));
    user=await cognito.send(new AdminGetUserCommand({UserPoolId:POOL,Username:user.Username}));
   }
   await validate(user,phone,false);const a=attrs(user);
   return {poolId:POOL,sub:a.sub,username:user.Username,phone:a.phone_number,phoneVerified:true};
  },
 };
}
module.exports={createIdentity};
