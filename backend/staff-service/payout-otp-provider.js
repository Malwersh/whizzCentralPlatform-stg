'use strict';
const {SSMClient,GetParameterCommand}=require('@aws-sdk/client-ssm');
const client=new SSMClient({region:'us-east-1'});let cached;
async function secret(){if(!process.env.PROFILE_OTP_KEY_PARAM)throw Object.assign(Error('PAYOUT_DESTINATION_SERVICE_UNAVAILABLE'),{code:'PAYOUT_DESTINATION_SERVICE_UNAVAILABLE'});if(!cached)cached=(await client.send(new GetParameterCommand({Name:process.env.PROFILE_OTP_KEY_PARAM,WithDecryption:true}))).Parameter.Value;return cached;}
async function send(phone,code){const response=await fetch('https://api.otpiq.com/api/sms',{method:'POST',headers:{Authorization:'Bearer '+await secret(),'Content-Type':'application/json'},body:JSON.stringify({phoneNumber:phone.replace(/^\+/,''),smsType:'verification',verificationCode:code,provider:process.env.PROFILE_OTP_PROVIDER||'whatsapp-telegram-sms',...(process.env.PROFILE_OTP_SENDER?{senderId:process.env.PROFILE_OTP_SENDER}:{})}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Object.assign(Error('PAYOUT_CODE_SEND_UNCONFIRMED'),{code:'PAYOUT_CODE_SEND_UNCONFIRMED'});}
module.exports={secret,send};
