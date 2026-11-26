import {createFinanceRollout} from './financeRollout';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {createStagingDispatchResponseIntegration} from './dispatchResponseIntegration';
/** Additional dispatch-only consumer. Existing published COD handler stays intact. */
export async function handler(event:Record<string,unknown>){
 if(process.env.DISPATCH_RESPONSE_INTEGRATION_MODE!=='REQUIRED')return {disabled:true,processed:0};
 if(process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1'||process.env.FINANCIAL_COD_ACCOUNT_ID!=='699561669180')throw Error('DISPATCH_RESPONSE_NOT_CONFIGURED');
 if(event?.source!=='aws.events'||event['detail-type']!=='Scheduled Event'||event.account!=='699561669180'||event.region!=='us-east-1')throw Error('DISPATCH_RESPONSE_TRIGGER_INVALID');
 const delivery=process.env.DISPATCH_RESPONSE_NOTICE_DELIVERY??'HELD';if(delivery!=='HELD'&&delivery!=='PENDING')throw Error('INVALID_DISPATCH_NOTICE_DELIVERY');
 const rawDb=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});const db=createFinanceRollout({db:rawDb}).db;
 return createStagingDispatchResponseIntegration({db,notificationDelivery:delivery}).run();
}
