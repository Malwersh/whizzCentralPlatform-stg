'use strict';
const workflow=require('./write-workflow');const direct=()=>workflow.direct?.()===true;
const {randomUUID}=require('crypto');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {AdminCreateUserCommand,AdminGetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {validateAssignment}=require('./catalog');
function fail(code,status=400){return Object.assign(Error(code),{status});}
function validate(input){
 if(input.status!==undefined&&input.status!=='ACTIVE')throw fail('INVALID_INITIAL_STATUS');
 if(typeof input.email!=='string'||input.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))throw fail('INVALID_EMAIL');
 if(typeof input.name!=='string'||input.name.trim().length<2||input.name.length>100)throw fail('INVALID_NAME');
 if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)throw fail('REASON_REQUIRED');
 let assignment;try{assignment=validateAssignment({...input,status:'ACTIVE'});}catch(e){throw fail(e.message);}
 return {email:input.email.trim().toLowerCase(),name:input.name.trim(),reason:input.reason.trim(),assignment};
}
async function create(context,actor,input){
 const {db,cognito,table,pool,guard,audit,validateRegions}=context;
 const value=validate(input);await validateRegions(value.assignment);
 try{await cognito.send(new AdminGetUserCommand({UserPoolId:pool,Username:value.email}));throw fail('ACCOUNT_ALREADY_EXISTS',409);}catch(e){if(e.name!=='UserNotFoundException')throw e;}
 const claimId=randomUUID(),emailKey={pk:'EMAIL#'+value.email,sk:'PROFILE'};
 // Reserving before Cognito prevents simultaneous creation and accidental account adoption.
 await db.send(new TransactWriteCommand({TransactItems:[guard(actor),{Put:{TableName:table,Item:{...emailKey,claimId,status:'CREATING',createdBy:actor.employeeId},ConditionExpression:'attribute_not_exists(pk)'}}]}));
 const result=await cognito.send(new AdminCreateUserCommand({UserPoolId:pool,Username:value.email,MessageAction:'SUPPRESS',UserAttributes:[{Name:'email',Value:value.email},{Name:'name',Value:value.name}]}));
 const employeeId=result.User.Attributes.find(a=>a.Name==='sub')?.Value;
 if(!employeeId)throw fail('PROVISIONING_INCOMPLETE',503);
 const now=new Date().toISOString(),changeId=randomUUID();
 const employee={pk:'EMPLOYEE#'+employeeId,sk:'PROFILE',employeeId,username:result.User.Username,email:value.email,name:value.name,roles:[],scope:{allRegions:false,regionIds:[]},status:'PENDING',approvalLimit:0,version:1,mfaRequired:true,activationApproved:false,invitationStatus:'DRAFT',createdAt:now,updatedAt:now};
 if(direct())Object.assign(employee,value.assignment,{status:'INVITED',activationApproved:true});
 const change={pk:'CHANGE#'+changeId,sk:'META',changeId,employeeId,baseVersion:1,requestedBy:actor.employeeId,requestedByVersion:actor.version,status:'PENDING',assignment:value.assignment,reason:value.reason,createdAt:now,expiresAt:Math.floor(Date.now()/1000)+3600};
 await db.send(new TransactWriteCommand({TransactItems:[guard(actor),{Put:{TableName:table,Item:employee,ConditionExpression:'attribute_not_exists(pk)'}},...(!direct()?[{Put:{TableName:table,Item:change,ConditionExpression:'attribute_not_exists(pk)'}}]:[]),{Update:{TableName:table,Key:emailKey,UpdateExpression:'SET #s = :complete, employeeId = :id',ConditionExpression:'claimId = :claim',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':complete':'CREATED',':id':employeeId,':claim':claimId}}},audit(actor.employeeId,'STAFF_INVITATION_PREPARED',null,{employeeId,email:value.email,changeId},changeId)]}));
 return {employee,...(!direct()?{change}:{}),directWrite:direct()};
}
async function send(context,actor,target){
 const {db,cognito,table,pool,guard,audit}=context;
 if(target.status!=='INVITED'||target.activationApproved!==true||target.invitationStatus!=='DRAFT')throw fail('INVITATION_NOT_READY',409);
 const claimId=randomUUID();
 await db.send(new TransactWriteCommand({TransactItems:[guard(actor),{Update:{TableName:table,Key:{pk:target.pk,sk:target.sk},UpdateExpression:'SET invitationStatus = :sending, deliveryClaim = :claim',ConditionExpression:'#v = :v AND #s = :invited AND invitationStatus = :draft',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':target.version,':invited':'INVITED',':draft':'DRAFT',':sending':'SENDING',':claim':claimId}}},audit(actor.employeeId,'STAFF_INVITATION_SEND_REQUESTED',null,{employeeId:target.employeeId},claimId)]}));
 // A timeout or uncertain response stays SENDING for operator review, never automatic RESEND.
 try{await cognito.send(new AdminCreateUserCommand({UserPoolId:pool,Username:target.email,UserAttributes:[{Name:'email',Value:target.email}],MessageAction:'RESEND',DesiredDeliveryMediums:['EMAIL']}));}catch(_){throw fail('INVITATION_DELIVERY_UNCERTAIN',503);}
 await db.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:table,Key:{pk:target.pk,sk:target.sk},UpdateExpression:'SET invitationStatus = :sent, invitedAt = :now',ConditionExpression:'deliveryClaim = :claim AND invitationStatus = :sending',ExpressionAttributeValues:{':claim':claimId,':sending':'SENDING',':sent':'SENT',':now':new Date().toISOString()}}},audit(actor.employeeId,'STAFF_INVITATION_SENT',null,{employeeId:target.employeeId},randomUUID())]}));
 return {employeeId:target.employeeId,invitationStatus:'SENT'};
}
module.exports={validate,create,send};
