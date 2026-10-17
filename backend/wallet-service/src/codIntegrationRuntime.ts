import {createFinanceRollout} from './financeRollout';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {createStagingDispatchResponseIntegration} from './dispatchResponseIntegration';
import { createStagingCodIntegration } from './codIntegration';

/** Scheduled internal worker only; no HTTP or user-selected operation handler. */
async function codAndDispatch(event: Record<string, unknown>) {
  const cod=process.env.FINANCIAL_COD_INTEGRATION_MODE==='REQUIRED',dispatch=process.env.DISPATCH_RESPONSE_INTEGRATION_MODE==='REQUIRED';
  if (!cod&&!dispatch) return { disabled: true, processed: 0 };
  if (process.env.STAGE !== 'staging' || process.env.AWS_REGION !== 'us-east-1' || process.env.FINANCIAL_COD_ACCOUNT_ID !== '699561669180') {
    throw Error('COD_INTEGRATION_NOT_CONFIGURED');
  }
  if (!event || event.source !== 'aws.events' || event['detail-type'] !== 'Scheduled Event' ||
      event.account !== '699561669180' || event.region !== 'us-east-1') throw Error('INVALID_COD_INTEGRATION_TRIGGER');
  const rawDb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }), { marshallOptions: { removeUndefinedValues: true } });const db=createFinanceRollout({db:rawDb}).db;
  const delivery = process.env.FINANCIAL_COD_NOTICE_DELIVERY ?? 'HELD';
  if (delivery !== 'HELD' && delivery !== 'PENDING') throw Error('INVALID_COD_NOTICE_DELIVERY');
  const result=cod?await createStagingCodIntegration({ db, notificationDelivery: delivery }).run():{disabled:true,processed:0};
  if(!dispatch)return result;
  const notice=process.env.DISPATCH_RESPONSE_NOTICE_DELIVERY??'HELD';if(notice!=='HELD'&&notice!=='PENDING')throw Error('INVALID_DISPATCH_NOTICE_DELIVERY');
  return {...result,dispatch:await createStagingDispatchResponseIntegration({db,notificationDelivery:notice}).run()};
}

// Preserve the scheduled COD/response result, then discover staff decisions independently.
export async function handler(event:Record<string,unknown>,context?:Parameters<typeof import('./dispatchReviewHostRuntime').handler>[1]) {
 const result=await codAndDispatch(event);
 if(!['SAFE_INITIAL_LEGACY','SAFE_LEGACY_RETRY'].includes(process.env.DISPATCH_REVIEW_EXECUTION_MODE??''))return result;
 const review=await (await import('./dispatchReviewHostRuntime')).handler(event,context??{});
 return {...result,review};
}
