import {WalletError} from './types';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function walletCreationCaller(event:any,roleArn=process.env.WALLET_CREATION_CALLER_ROLE_ARN){
 const role=roleArn?.match(/^arn:aws:iam::(\d{12}):role\/(?:[^/]+\/)*([^/]+)$/);
 const identity=event?.requestContext?.identity;
 const caller=identity?.userArn?.match(/^arn:aws:sts::(\d{12}):assumed-role\/([^/]+)\/([^/]+)$/);
 if(!role||!caller||role[1]!==caller[1]||role[2]!==caller[2]||identity.accountId!==role[1]||!identity.accessKey)
  throw new WalletError('Only the configured IAM wallet creation role may provision wallets','WALLET_CREATION_CALLER_REQUIRED',403);
}
export function walletCreationInput(v:any){
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.driverId!=='string'||!uuid.test(v.driverId)||Object.keys(v).some(k=>!['driverId','minRequiredBalance'].includes(k))||(v.minRequiredBalance!==undefined&&v.minRequiredBalance!==25000))
  throw new WalletError('A valid driver identity is required; balance and wallet ownership cannot be supplied','INVALID_REQUEST',400);
 return {driverId:v.driverId,minRequiredBalance:25000};
}
export function trustedDriverConfirmation(event:any,pool=process.env.DRIVER_USER_POOL_ID){
 return !!pool&&event?.userPoolId===pool&&['PostConfirmation_ConfirmSignUp','PostConfirmation_ConfirmForgotPassword'].includes(event?.triggerSource)&&typeof event?.request?.userAttributes?.sub==='string'&&uuid.test(event.request.userAttributes.sub);
}
