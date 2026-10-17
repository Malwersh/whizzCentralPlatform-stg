import { GetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { quoteCanonical } from './deliveryQuoteRecord';
export type FinancialRow = Record<string, any>;
export const detach = <T>(v:T):T => JSON.parse(JSON.stringify(v));
export const equal = (a:unknown,b:unknown) => quoteCanonical(a)===quoteCanonical(b);
export async function strongGet(db:Pick<DynamoDBDocumentClient,'send'>,TableName:string,Key:FinancialRow) {
  return detach((await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item ?? null);
}
export function exactCheck(TableName:string,Key:FinancialRow,saved:FinancialRow,fields=Object.keys(saved)) {
  const names:FinancialRow={},values:FinancialRow={},conditions:string[]=[];
  fields.forEach((field,i)=>{names['#f'+i]=field;if(saved[field]===undefined)conditions.push(`attribute_not_exists(#f${i})`);
    else {values[':v'+i]=detach(saved[field]);conditions.push(`#f${i}=:v${i}`);}});
  return {ConditionCheck:{TableName,Key,ConditionExpression:conditions.join(' AND '),ExpressionAttributeNames:names,
    ...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}};
}
export function updateChecked(check:FinancialRow,UpdateExpression:string,names:FinancialRow,values:FinancialRow) {
  const c=check.ConditionCheck;
  return {Update:{...c,UpdateExpression,ExpressionAttributeNames:{...c.ExpressionAttributeNames,...names},
    ExpressionAttributeValues:{...c.ExpressionAttributeValues,...values}}};
}
