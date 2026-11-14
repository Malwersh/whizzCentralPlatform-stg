import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
type Row=Record<string,any>;
const fail=():never=>{throw Object.assign(Error('RETURN_ITEMS_INVALID'),{code:'RETURN_ITEMS_INVALID'});};
const conditions=['SEALED_INTACT','INTACT_NOT_RESALEABLE','DAMAGED','SPOILED','UNKNOWN','MISSING'];
/** Server snapshot of order lines. Never infer unit identities for historical orders. */
export function createReturnItemManifest(order:Row,offerDigest:string){
 if(!Array.isArray(order.items)||!order.items.length||order.items.length>100)return null;
 const ids=new Set<string>(),lines:Row[]=[];
 for(const item of order.items){if(!item||!quoteEntityIdValid(item.lineId)||ids.has(item.lineId)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000||typeof item.name!=='string'||!item.name.trim()||item.name.length>300)return null;ids.add(item.lineId);lines.push({lineId:item.lineId,name:item.name,expectedQty:item.quantity});}
 const body={schemaVersion:1,orderId:order.orderId,attempt:order.assignmentAttemptCounter,offerDigest,lines};return {...body,digest:quoteHash(body)};
}
export function verifyReturnItemReceipt(manifest:Row,input:unknown,actorId:string,at:string){
 const {digest,...body}=manifest||{};if(digest!==quoteHash(body)||body.schemaVersion!==1||!Array.isArray(body.lines)||!body.lines.length||body.lines.length>100||!Array.isArray(input)||input.length!==body.lines.length)return fail();
 const seen=new Set(),byId=new Map<string,Row>();
 for(const item of input){if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['lineId','receivedQty','condition','note'].includes(k))||!['lineId','receivedQty','condition'].every(k=>Object.prototype.hasOwnProperty.call(item,k))||!quoteEntityIdValid(item.lineId)||seen.has(item.lineId)||!Number.isSafeInteger(item.receivedQty)||item.receivedQty<0||!conditions.includes(item.condition)||item.note!==undefined&&(typeof item.note!=='string'||item.note.length>500))return fail();seen.add(item.lineId);byId.set(item.lineId,item);}
 const lines=body.lines.map((line:Row)=>{const item=byId.get(line.lineId);if(!item||!Number.isSafeInteger(line.expectedQty)||line.expectedQty<1||line.expectedQty>1000||item.receivedQty>line.expectedQty||(item.receivedQty===0)!==(item.condition==='MISSING'))return fail();return {...line,receivedQty:item.receivedQty,unresolvedQty:line.expectedQty-item.receivedQty,condition:item.condition,...(item.note?.trim()?{note:item.note.trim()}:{} )};});
 const expectedTotal=lines.reduce((s:number,l:Row)=>s+l.expectedQty,0),receivedTotal=lines.reduce((s:number,l:Row)=>s+l.receivedQty,0),unresolvedTotal=expectedTotal-receivedTotal;
 const receipt={schemaVersion:1,manifestDigest:digest,lines,expectedTotal,receivedTotal,unresolvedTotal,recordedBy:actorId,recordedAt:at,unreceivedMeans:'UNRESOLVED_CUSTODY_NOT_PROVEN_LOSS',resaleAuthorized:false};
 return {receipt:{...receipt,digest:quoteHash(receipt)},allItemsReceived:unresolvedTotal===0,condition:unresolvedTotal?'MISSING':lines.some((l:Row)=>['DAMAGED','SPOILED','UNKNOWN'].includes(l.condition))?'DAMAGED':'INTACT'};
}
