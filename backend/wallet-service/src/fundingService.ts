import { randomUUID, createHash } from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { docClient, TABLES, GetCommand, TransactWriteCommand } from './db';
import { WalletError } from './types';
import {readWalletLimits} from './walletOperatingLimits';
const s3 = new S3Client({});
const bucket = process.env.FUNDING_RECEIPTS_BUCKET || '';
const configKey = { idempotencyKey: 'CONFIG#FUNDING', sk: 'META' };
export const fundingError = (message: string, code = 'INVALID_FUNDING_REQUEST', status = 400) => new WalletError(message, code, status);
export async function getFundingConfig() {
 const { Item } = await docClient.send(new GetCommand({ TableName: TABLES.IDEMPOTENCY_KEYS, Key: configKey, ConsistentRead: true }));
 const config=Item?.config || { version: 0, manual: { enabled: false, phone: '07800868280', name: 'محمد علي دعاش', minimum: 25000 }, zaincash: { enabled: false }, card: { enabled: false } };
 const limits=await readWalletLimits(docClient,TABLES.IDEMPOTENCY_KEYS);
 return {...config,limitsVersion:limits.version,manual:{...config.manual,minimum:limits.manualMinimumIqd,maximum:limits.manualMaximumIqd}};
}
export async function saveFundingConfig(input: any, actor: string) {
 const previous = await getFundingConfig();
 if (input.version !== previous.version) throw fundingError('الإعدادات تغيرت؛ أعد تحميل الصفحة', 'CONFIG_CONFLICT', 409);
 const phone = String(input.manual?.phone || '').replace(/\s/g, '');
 const name = String(input.manual?.name || '').trim();
 if (!/^07\d{9}$/.test(phone) || !name || name.length > 120) throw fundingError('رقم المستلم أو الاسم غير صالح');
 const config = { version: previous.version + 1, manual: { enabled: input.manual?.enabled === true, phone, name, minimum: 25000 }, zaincash: { enabled: false }, card: { enabled: false } };
 const now = new Date().toISOString();
 await docClient.send(new TransactWriteCommand({ TransactItems: [
  { Put: { TableName: TABLES.IDEMPOTENCY_KEYS, Item: { ...configKey, config, updatedAt: now, updatedBy: actor }, ConditionExpression: previous.version === 0 ? 'attribute_not_exists(idempotencyKey)' : 'config.#version = :version', ...(previous.version === 0 ? {} : {ExpressionAttributeNames:{'#version':'version'},ExpressionAttributeValues:{':version':previous.version}}) } },
  { Put: { TableName: TABLES.AUDIT_LOG, Item: { datePartition: now.slice(0,10), sk: `${now}#${randomUUID()}`, action: 'FUNDING_CONFIG_UPDATED', actorId: actor, before: previous, after: config } } }
 ] }));
 return config;
}
export async function receiptUpload(driver: string, input: any) {
 if (!['image/jpeg','image/png'].includes(input.contentType) || !Number.isInteger(input.size) || input.size < 1 || input.size > 4 * 1024 * 1024) throw fundingError('الوصل يجب أن يكون صورة JPG أو PNG بحجم لا يتجاوز 4 ميجابايت');
 const walletId=`WALLET#DRIVER#${driver}`;
 const {Item:wallet}=await docClient.send(new GetCommand({TableName:TABLES.WALLETS,Key:{walletId,sk:'META'},ConsistentRead:true}));
 if(!wallet||wallet.status!=='ACTIVE'||wallet.deletionRequestId)throw fundingError('هذه المحفظة غير متاحة للشحن','ACCOUNT_CLOSING',409);
 const operationId=randomUUID(),key = `receipts/${driver}/${operationId}.${input.contentType === 'image/png' ? 'png' : 'jpg'}`;
 const deletionTable=process.env.ACCOUNT_DELETION_TABLE;
 const operations:any[]=[{Update:{TableName:TABLES.WALLETS,Key:{walletId,sk:'META'},UpdateExpression:'SET #v = #v + :one',ConditionExpression:'#v = :v AND #s = :active AND attribute_not_exists(deletionRequestId)',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':wallet.version,':one':1,':active':'ACTIVE'}}}];
 if(deletionTable){
  if(deletionTable!=='staging-AccountDeletion'||process.env.ENVIRONMENT!=='staging')throw fundingError('إعداد التحقق غير صحيح','INVALID_LIFECYCLE_CONFIGURATION',503);
  operations.push({ConditionCheck:{TableName:deletionTable,Key:{pk:`ACCOUNT_LIFECYCLE#DRIVER#${driver}`,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:deletionTable,Item:{pk:`ACCOUNT_OPERATION#DRIVER#${driver}`,sk:`FUNDING_RECEIPT#${operationId}`,subjectId:driver,operationId,kind:'FUNDING_RECEIPT',assetKey:key,expiresAt:Math.floor(Date.now()/1000)+600},ConditionExpression:'attribute_not_exists(pk)'}});
 }
 await docClient.send(new TransactWriteCommand({TransactItems:operations}));
 const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.contentType, ContentLength: input.size, ServerSideEncryption:'AES256', IfNoneMatch:'*' }), { expiresIn: 300 });
 return { key, uploadUrl, contentType: input.contentType };
}
export async function validateReceipt(driver: string, key: string) {
 if (typeof key !== 'string' || !new RegExp(`^receipts/${driver}/[a-f0-9-]+\\.(jpg|png)$`).test(key)) throw fundingError('الوصل لا يخص هذا الحساب');
 const head = await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
 if (!head.ContentLength || head.ContentLength > 4*1024*1024 || !['image/jpeg','image/png'].includes(head.ContentType || '')) throw fundingError('صورة الوصل غير صالحة');
 const object = await s3.send(new GetObjectCommand({Bucket:bucket,Key:key,Range:'bytes=0-7'}));
 const bytes = await object.Body!.transformToByteArray();
 const valid = head.ContentType === 'image/png' ? Buffer.from(bytes).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
 if (!valid) throw fundingError('محتوى الملف ليس صورة صالحة');
}
export async function receiptView(key: string) {
 if (!/^receipts\/[a-zA-Z0-9-]+\/[a-f0-9-]+\.(jpg|png)$/.test(key)) throw fundingError('مفتاح الوصل غير صالح');
 return { url: await getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:300}) };
}
export function referenceHash(reference: string) { return createHash('sha256').update(reference.trim().toUpperCase()).digest('hex'); }
