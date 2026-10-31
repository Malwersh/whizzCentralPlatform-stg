import { docClient, TABLES, ScanCommand, GetCommand } from './db';
import {summarizeLedger} from './ledgerEffects';

export function reconcile(wallets: any[], holds: any[], ledger: any[], now = Date.now(), payoutRows: any[] = []) {
  const issues: any[] = [], valid=(n:any)=>Number.isSafeInteger(n)&&n>=0;
  const walletIds=new Set(wallets.filter(w=>w.sk==='META').map(w=>w.walletId));
  const entriesByWallet=new Map<string,any[]>(),holdsByWallet=new Map<string,any[]>();
  for(const e of ledger){const entries=entriesByWallet.get(e.walletId)||[];entries.push(e);entriesByWallet.set(e.walletId,entries);if(!walletIds.has(e.walletId))issues.push({type:'ORPHAN_LEDGER',walletId:e.walletId,message:'قيد بلا محفظة ضمن البيانات المقروءة؛ يحتاج مراجعة المصدر'});}
  for(const h of holds){if(!h.walletId)continue;const rows=holdsByWallet.get(h.walletId)||[];rows.push(h);holdsByWallet.set(h.walletId,rows);if(h.status==='ACTIVE'&&!walletIds.has(h.walletId))issues.push({type:'ORPHAN_HOLD',walletId:h.walletId,orderId:h.orderId,holdId:h.holdId,message:'حجز فعّال بلا محفظة ضمن البيانات المقروءة'});}
  const balances = wallets.filter(w=>w.sk==='META').map(w=>{
    const entries=entriesByWallet.get(w.walletId)||[],rows=holdsByWallet.get(w.walletId)||[];
    const active=rows.filter(h=>h.status==='ACTIVE'&&(h.sk==='HOLD'||h.sk===undefined&&h.holdId));
    const pendingMerchant=rows.filter(h=>w.ownerType==='MERCHANT'&&h.sk==='MERCHANT_PAYABLE'&&['MERCHANT_ORDER_PAYABLE','MERCHANT_EXCEPTION_PAYABLE'].includes(h.kind)&&h.status==='LOCKED_PENDING_SETTLEMENT');
    const total=(xs:any[])=>{let n=0;for(const h of xs){const a=h.returnFinancialVersion?h.returnRemainingAmount:h.amount;if(!valid(a)||!Number.isSafeInteger(n+a)){issues.push({type:'INVALID_HOLD_VALUE',walletId:w.walletId,orderId:h.orderId,message:'مبلغ حجز أو مستحق غير صالح؛ لا يمكن الجزم بالمحجوز'});return null;}n+=a;}return n;};
    const activeHoldTotal=total(active),pendingMerchantPayableTotal=total(pendingMerchant);
    let payoutReserved=0,payoutValid=true;
    if(w.driverPayoutActiveId!=null||(w.driverPayoutReservedIqd??0)!==0){
      const p=payoutRows.find(p=>p.payoutId===w.driverPayoutActiveId&&p.driverId===w.ownerId),m=p?.amount;
      payoutValid=w.ownerType==='DRIVER'&&w.walletId==='WALLET#DRIVER#'+w.ownerId&&valid(w.driverPayoutReservedIqd)&&w.driverPayoutReservedIqd>0&&p?.kind==='DRIVER_CASH_PAYOUT'&&p.pk==='DRIVER_PAYOUT#'+w.ownerId&&p.sk==='PAYOUT#'+w.driverPayoutActiveId&&['UNDER_REVIEW','APPROVED','PROCESSING','AWAITING_RECEIPT','RECEIPT_CONFIRMED','RECONCILIATION_REQUIRED','NON_RECEIPT_CONFIRMED'].includes(p.status)&&m?.currency==='IQD'&&m.scale===1000&&Number.isSafeInteger(m.minorAmount)&&m.minorAmount/1000===w.driverPayoutReservedIqd;
      if(payoutValid)payoutReserved=w.driverPayoutReservedIqd;
      else issues.push({type:'PAYOUT_RESERVATION_UNVERIFIED',walletId:w.walletId,message:'حجز الصرف لا يطابق طلب صرف فعّال؛ تبقى المطابقة للمراجعة'});
    }
    const summary=summarizeLedger(entries).summary,classified=summary.status==='AVAILABLE',totals=classified?(summary as any).totals:null;
    // summarizeLedger may include both internal movement sides; interpret buckets, never sum raw signs.
    const availableNet=classified?totals.AVAILABLE.net:null,lockedNet=classified?totals.LOCKED.net:null;
    if(!classified)issues.push({type:'UNCLASSIFIED_LEDGER',walletId:w.walletId,unclassifiedCount:summary.unclassifiedCount,message:'حركات غير مصنفة أو مجموع غير آمن؛ لا يمكن إعلان تطابق الرصيد'});
    const balanceValid=valid(w.availableBalance)&&valid(w.lockedBalance)&&Number.isSafeInteger(w.availableBalance+w.lockedBalance);
    if(!balanceValid)issues.push({type:'INVALID_WALLET_BALANCE',walletId:w.walletId,message:'رصيد غير صالح أو سالب يحتاج مراجعة'});
    const ledgerNet=classified&&Number.isSafeInteger(availableNet+lockedNet)?availableNet+lockedNet:null;
    const safeDiff=(a:number,b:number)=>Number.isSafeInteger(a-b)?a-b:null;
    const difference=balanceValid&&ledgerNet!==null?safeDiff(w.availableBalance+w.lockedBalance,ledgerNet):null;
    const availableDifference=balanceValid&&classified?safeDiff(w.availableBalance,availableNet):null,lockedDifference=balanceValid&&classified?safeDiff(w.lockedBalance,lockedNet):null;
    if(balanceValid&&classified&&(difference===null||availableDifference===null||lockedDifference===null))issues.push({type:'UNSAFE_BALANCE_DIFFERENCE',walletId:w.walletId,message:'الفرق يتجاوز المجال العددي الآمن؛ يحتاج مراجعة المصدر'});
    if(difference!==null&&(difference!==0||availableDifference!==0||lockedDifference!==0))issues.push({type:'UNEXPLAINED_BALANCE',walletId:w.walletId,amount:difference,availableDifference,lockedDifference,message:'فرق عن القيود المصنفة؛ يحتاج إثبات الرصيد الافتتاحي أو الحركات المفقودة، ولا يصحح آليًا'});
    const lockedExpected=activeHoldTotal!==null&&pendingMerchantPayableTotal!==null&&payoutValid&&Number.isSafeInteger(activeHoldTotal+pendingMerchantPayableTotal+payoutReserved)?activeHoldTotal+pendingMerchantPayableTotal+payoutReserved:null;
    if(balanceValid&&lockedExpected!==null&&lockedExpected!==w.lockedBalance)issues.push({type:'LOCKED_MISMATCH',walletId:w.walletId,amount:w.lockedBalance-lockedExpected,message:'المحجوز لا يطابق ضمان الطلبات ومستحقات المطعم وحجز الصرف الفعّال'});
    for(const h of active){const t=Date.parse(h.createdAt);if(!Number.isFinite(t)||now-t>86400000)issues.push({type:'STALE_HOLD',walletId:w.walletId,holdId:h.holdId,orderId:h.orderId,amount:h.returnFinancialVersion?h.returnRemainingAmount:h.amount,originalAmount:h.amount,createdAt:h.createdAt,message:'حجز تجاوز 24 ساعة أو تاريخ غير صالح؛ يلزم التحقق من الطلب قبل الفك'});}
    return {walletId:w.walletId,available:w.availableBalance,locked:w.lockedBalance,ledgerNet,difference,availableLedgerNet:availableNet,lockedLedgerNet:lockedNet,availableDifference,lockedDifference,activeHoldTotal,pendingMerchantPayableTotal,driverPayoutReservedIqd:payoutValid?payoutReserved:null,lockedExpected,balanceStatus:!balanceValid||!classified||!payoutValid||lockedExpected===null||difference===null||availableDifference===null||lockedDifference===null?'UNVERIFIED':difference===0&&availableDifference===0&&lockedDifference===0&&lockedExpected===w.lockedBalance?'MATCHED':'REVIEW_REQUIRED',ruleVersion:summary.ruleVersion,unclassifiedCount:summary.unclassifiedCount};
  });
  for (const hold of holds.filter(h => h.status === 'CAPTURED')) {
    const credits = ledger.filter(e => e.walletId === 'WALLET#PLATFORM' && e.type === 'SETTLEMENT_RECEIVED' && (e.relatedEntityId === hold.holdId || e.metadata?.holdId === hold.holdId));
    const debits = ledger.filter(e => e.walletId === hold.walletId && e.type === 'HOLD_CAPTURED' && (e.relatedEntityId === hold.holdId || e.metadata?.holdId === hold.holdId));
    const remainder = (hold.amount ?? hold.capturedAmount) - hold.capturedAmount;
    const releases = ledger.filter(e => e.walletId === hold.walletId && e.type === 'HOLD_PARTIAL_RELEASE' && (e.relatedEntityId === hold.holdId || e.metadata?.holdId === hold.holdId));
    const transaction = credits[0]?.transactionId || credits[0]?.txnId;
    const validRelease = remainder === 0 ? releases.length === 0 : releases.length === 1 && releases[0].amount === remainder && (releases[0].transactionId || releases[0].txnId) === transaction;
    if (credits.length !== 1 || debits.length !== 1 || !validRelease || credits[0]?.amount !== hold.capturedAmount || debits[0]?.amount !== -(hold.amount ?? hold.capturedAmount) || transaction !== (debits[0]?.transactionId || debits[0]?.txnId)) issues.push({ type: 'CAPTURE_LEDGER_MISMATCH', walletId: hold.walletId, holdId: hold.holdId, orderId: hold.orderId, message: 'قيود تثبيت الحجز لا تطابق المبلغ أو مرجع العملية' });
  }
  return { wallets: balances, issues };
}
async function readTable(TableName: string, deadline = Date.now()+20000) {
  const rows: any[] = [];
  let start: Record<string, any> | undefined;
  for (let page = 0; page < 100; page++) {
    if(Date.now()>deadline)return {rows,complete:false};
    const result = await docClient.send(new ScanCommand({ TableName, Limit: 100, ConsistentRead: true, ExclusiveStartKey: start }));
    rows.push(...(result.Items || []));
    start = result.LastEvaluatedKey;
    if (!start) return { rows, complete: true };
  }
  return { rows, complete: false };
}
export async function reconciliationReport() {
  const startedAt = new Date().toISOString(),deadline=Date.now()+20000;
  const [wallets, holds, ledger] = await Promise.all([readTable(TABLES.WALLETS,deadline), readTable(TABLES.HOLDS,deadline), readTable(TABLES.LEDGER,deadline)]);
  let complete = wallets.complete && holds.complete && ledger.complete;
  const payouts:any[]=[];
  if(complete){const active=wallets.rows.filter(w=>w.sk==='META'&&w.ownerType==='DRIVER'&&w.driverPayoutActiveId!=null);for(let i=0;i<active.length;i+=20){if(Date.now()>deadline){complete=false;break;}const page=await Promise.all(active.slice(i,i+20).map(w=>docClient.send(new GetCommand({TableName:'staging-MerchantPlatform',Key:{pk:'DRIVER_PAYOUT#'+w.ownerId,sk:'PAYOUT#'+w.driverPayoutActiveId},ConsistentRead:true,ProjectionExpression:'pk,sk,kind,driverId,payoutId,#s,amount',ExpressionAttributeNames:{'#s':'status'}}))));payouts.push(...page.flatMap(r=>r.Item?[r.Item]:[]));}}
  return { complete, startedAt, completedAt: new Date().toISOString(), note: 'قراءة للمراجعة فقط؛ الجداول لا تُقرأ كلقطة ذرية واحدة وقد تتغير أثناء الفحص. لا تُعد الفروقات إثباتاً لخطأ أو إذناً لتعديل الرصيد.', ...(complete ? reconcile(wallets.rows, holds.rows, ledger.rows, Date.now(), payouts) : { wallets: [], issues: [], error: 'تجاوز الفحص حد الحجم أو المهلة؛ أعد المحاولة، ولا يمكن إصدار نتيجة مكتملة' }) };
}
