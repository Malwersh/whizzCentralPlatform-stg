import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet} from './driverFinancialTransaction';
import {validateDispatchCycle} from './dispatchCycle';
const {dispatchOfferSK}=require('../../src/utils/dispatch-cycle-keys');
/** One deterministic namespace. Never fall back from a replacement cycle to an
 * earlier offer. Existing completed orders retain their established keys. */
export async function financialOfferSK(db:Pick<DynamoDBDocumentClient,'send'>,orderId:string,driverId:string,waveNumber:number,assignmentId?:string):Promise<string>{
 const job=(await db.send(new GetCommand({TableName:'WizzDispatchJobs_staging',Key:{orderId,SK:'METADATA'},ConsistentRead:true,ProjectionExpression:'#id,#job,#cycle',ExpressionAttributeNames:{'#id':'orderId','#job':'dispatchJobId','#cycle':'dispatchCycle'}}))).Item;
 if(assignmentId!==undefined&&job?.dispatchJobId!==assignmentId)throw Error('FINANCIAL_OFFER_CYCLE_CHANGED');
 if(job?.dispatchCycle!==undefined){const cycle=validateDispatchCycle(job.dispatchCycle);if(cycle.engine!=='FINANCIAL'||cycle.orderId!==orderId||cycle.assignmentId!==job.dispatchJobId)throw Error('FINANCIAL_CYCLE_REQUIRED');return dispatchOfferSK(cycle,driverId,waveNumber);}
 return dispatchOfferSK({id:'unversioned',engine:'FINANCIAL'},driverId,waveNumber);
}

/** Historical evidence stores its exact source key. Pre-namespace records have
 * one established key; never search other cycles or infer a replacement source. */
export async function historicalFinancialOfferSK(db:Pick<DynamoDBDocumentClient,'send'>,orderId:string,driverId:string,waveNumber:number,offerId:string,storageKey?:string):Promise<string>{
 const legacy=dispatchOfferSK({id:'unversioned',engine:'FINANCIAL'},driverId,waveNumber);
 const key=storageKey??legacy;
 if(key!==legacy&&!new RegExp('^CYCLE#[a-f0-9]{64}#FINANCIAL#'+driverId.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'#WAVE#'+waveNumber+'$').test(key))throw Error('HISTORICAL_FINANCIAL_OFFER_CONFLICT');
 const candidate=await strongGet(db,'WaveOffers_staging',{orderId,SK:key});
 if(candidate?.offerId!==offerId||candidate.kind!=='FINANCIAL_DRIVER_OFFER'||candidate.driverId!==driverId||candidate.waveNumber!==waveNumber)throw Error('HISTORICAL_FINANCIAL_OFFER_UNAVAILABLE');
 return key;
}
