import { docClient, TABLES, ScanCommand } from './db';

export function reconcile(wallets: any[], holds: any[], ledger: any[], now = Date.now()) {
  const issues: any[] = [];
  const balances = wallets.filter(w => w.sk === 'META').map(w => {
    const entries = ledger.filter(e => e.walletId === w.walletId);
    const active = holds.filter(h => h.walletId === w.walletId && h.status === 'ACTIVE');
    const lockedExpected = active.reduce((sum, h) => sum + h.amount, 0);
    const ledgerNet = entries.reduce((sum, e) => sum + e.amount, 0);
    const actualTotal = w.availableBalance + w.lockedBalance;
    const gap = actualTotal - ledgerNet;
    if (gap !== 0) issues.push({ type: 'UNEXPLAINED_BALANCE', walletId: w.walletId, amount: gap, message: 'فرق عن صافي القيود المتاحة؛ يحتاج إثبات الرصيد الافتتاحي أو الحركات المفقودة' });
    if (lockedExpected !== w.lockedBalance) issues.push({ type: 'LOCKED_MISMATCH', walletId: w.walletId, amount: w.lockedBalance - lockedExpected, message: 'المحجوز لا يطابق الحجوزات الفعالة' });
    if (w.availableBalance < 0 || w.lockedBalance < 0) issues.push({ type: 'NEGATIVE_BALANCE', walletId: w.walletId, message: 'رصيد سالب يحتاج مراجعة' });
    for (const h of active) {
      const timestamp = Date.parse(h.createdAt);
      if (!Number.isFinite(timestamp) || now - timestamp > 24 * 60 * 60 * 1000) issues.push({ type: 'STALE_HOLD', walletId: w.walletId, holdId: h.holdId, orderId: h.orderId, amount: h.amount, createdAt: h.createdAt, message: 'حجز تجاوز 24 ساعة أو تاريخ غير صالح؛ يلزم التحقق من الطلب قبل الفك' });
    }
    return { walletId: w.walletId, available: w.availableBalance, locked: w.lockedBalance, ledgerNet, difference: gap, activeHoldTotal: lockedExpected };
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
async function readTable(TableName: string) {
  const rows: any[] = [];
  let start: Record<string, any> | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await docClient.send(new ScanCommand({ TableName, Limit: 100, ConsistentRead: true, ExclusiveStartKey: start }));
    rows.push(...(result.Items || []));
    start = result.LastEvaluatedKey;
    if (!start) return { rows, complete: true };
  }
  return { rows, complete: false };
}
export async function reconciliationReport() {
  const startedAt = new Date().toISOString();
  const [wallets, holds, ledger] = await Promise.all([readTable(TABLES.WALLETS), readTable(TABLES.HOLDS), readTable(TABLES.LEDGER)]);
  const complete = wallets.complete && holds.complete && ledger.complete;
  return { complete, startedAt, completedAt: new Date().toISOString(), note: 'قراءة للمراجعة فقط؛ الجداول لا تُقرأ كلقطة ذرية واحدة وقد تتغير أثناء الفحص. لا تُعد الفروقات إثباتاً لخطأ أو إذناً لتعديل الرصيد.', ...(complete ? reconcile(wallets.rows, holds.rows, ledger.rows) : { wallets: [], issues: [], error: 'تجاوز حجم البيانات حد الفحص؛ لا يمكن إصدار نتيجة مكتملة' }) };
}
