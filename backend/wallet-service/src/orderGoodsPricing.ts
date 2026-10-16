import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Money, addMoney, moneyFromMinor, multiplyMoney, parseIqd } from './money';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';

type Row = Record<string, any>;
const TABLE = 'WhizzMerchants_Products';
// The two existing manual product writers store price in IQD in this table, not order pricing's minor units.
const knownFields = ['productId', 'businessId', 'globalProductId', 'name', 'description', 'price', 'categoryId',
  'imageUrl', 'barcode', 'isAvailable', 'searchableName', 'createdAt', 'updatedAt',
  'imageUrls', 'images', 'nutritionalInfo', 'allergens', 'preparationTime', 'rating', 'reviewCount'];
const unsupported = ['stock', 'inventory', 'trackInventory', 'unit', 'unitPrice', 'salePrice', 'discountPrice',
  'options', 'optionGroups', 'modifiers', 'variants', 'sizes', 'isDeleted', 'deletedAt', 'deletionStatus', 'isActive'];
const fencedFields = ['productId', 'businessId', 'price', 'categoryId', 'isAvailable', 'updatedAt', ...unsupported];
export class OrderGoodsPricingError extends Error {
  constructor(public readonly code: 'INVALID_GOODS_SELECTION' | 'GOODS_UNAVAILABLE' | 'GOODS_PRICING_UNSUPPORTED' | 'GOODS_PRICING_UNAVAILABLE') {
    super(code); this.name = 'OrderGoodsPricingError';
  }
}
const fail = (code: OrderGoodsPricingError['code']): never => { throw new OrderGoodsPricingError(code); };
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function exact(value: unknown, keys: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) return fail('INVALID_GOODS_SELECTION');
  return value as Row;
}
/** Internal server price source for the existing simple manual-product contract only. No HTTP,
 * authentication, stock reservation, discount/commission calculation, snapshot persistence or AWS writes.
 * Call before customer confirmation, never reprice an already-confirmed order at dispatch time.
 */
export function createStagingOrderGoodsPricing(options: { db: Pick<DynamoDBDocumentClient, 'send'> }) {
  return Object.freeze({ async price(value: unknown) {
    const input = exact(value, ['branchId', 'items']);
    if (!quoteEntityIdValid(input.branchId) || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 40) return fail('INVALID_GOODS_SELECTION');
    const branchId = input.branchId as string;
    // Validate and detach every selector before any I/O; async caller mutation cannot redirect later reads.
    const selections = input.items.map((raw: unknown) => {
      const item = exact(raw, ['productId', 'quantity']);
      if (!quoteEntityIdValid(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) return fail('INVALID_GOODS_SELECTION');
      return { productId: item.productId as string, quantity: item.quantity as number };
    });
    if (new Set(selections.map(i => i.productId)).size !== selections.length) return fail('INVALID_GOODS_SELECTION');
    const lines: { productId: string; quantity: number; unitPrice: Money; lineTotal: Money }[] = [];
    const conditions: Row[] = [], categories = new Set<string>();
    let goodsGross = moneyFromMinor(0), conditionBytes = 0;
    for (const item of selections) {
      let product: Row | undefined;
      try { product = (await options.db.send(new GetCommand({ TableName: TABLE, Key: { productId: item.productId }, ConsistentRead: true }))).Item; }
      catch { return fail('GOODS_PRICING_UNAVAILABLE'); }
      if (!product || product.productId !== item.productId || product.businessId !== branchId || product.isAvailable !== true) return fail('GOODS_UNAVAILABLE');
      // An unfamiliar schema may carry additional pricing or inventory constraints. Never silently drop it.
      if (Object.keys(product).some(k => !knownFields.includes(k)) || !quoteEntityIdValid(product.categoryId)) return fail('GOODS_PRICING_UNSUPPORTED');
      let unitPrice: Money, lineTotal: Money;
      try {
        if (typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price <= 0 || product.price > 1000000000) return fail('GOODS_PRICING_UNSUPPORTED');
        // Convert decimal text exactly, with at most three decimals. No floating multiplication/rounding.
        unitPrice = parseIqd(String(product.price));
        lineTotal = multiplyMoney(unitPrice, item.quantity, 1, 'EXACT');
        goodsGross = addMoney(goodsGross, lineTotal);
      } catch { return fail('GOODS_PRICING_UNSUPPORTED'); }
      const names: Row = {}, values: Row = {}, expressions: string[] = [];
      for (const [i, field] of fencedFields.entries()) {
        const alias = '#g' + i; names[alias] = field;
        if (product[field] === undefined) expressions.push(`attribute_not_exists(${alias})`);
        else { values[':g' + i] = copy(product[field]); expressions.push(`${alias} = :g${i}`); }
      }
      const condition = { ConditionCheck: { TableName: TABLE, Key: { productId: item.productId },
        ConditionExpression: expressions.join(' AND '), ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
      conditionBytes += Buffer.byteLength(JSON.stringify(condition));
      if (conditionBytes > 200000) return fail('GOODS_PRICING_UNSUPPORTED');
      conditions.push(condition); lines.push({ ...item, unitPrice, lineTotal });
      if (!categories.has(product.categoryId)) {
        const categoryFields = ['categoryId', 'businessId', 'isActive', 'is_active'];
        const categoryNames = Object.fromEntries(categoryFields.map((f, i) => ['#c' + i, f]));
        let category: Row | undefined;
        try { category = (await options.db.send(new GetCommand({ TableName: 'WhizzMerchants_Categories',
          Key: { categoryId: product.categoryId }, ConsistentRead: true, ProjectionExpression: Object.keys(categoryNames).join(', '),
          ExpressionAttributeNames: categoryNames }))).Item; }
        catch { return fail('GOODS_PRICING_UNAVAILABLE'); }
        if (!category || category.categoryId !== product.categoryId ||
            (category.businessId !== undefined && category.businessId !== branchId) ||
            ['isActive', 'is_active'].some(k => category![k] !== undefined && category![k] !== true)) return fail('GOODS_UNAVAILABLE');
        const categoryValues: Row = {}, categoryExpressions: string[] = [];
        for (const [i, f] of categoryFields.entries()) {
          if (category[f] === undefined) categoryExpressions.push(`attribute_not_exists(#c${i})`);
          else { categoryValues[':c' + i] = copy(category[f]); categoryExpressions.push(`#c${i} = :c${i}`); }
        }
        conditions.push({ ConditionCheck: { TableName: 'WhizzMerchants_Categories', Key: { categoryId: product.categoryId },
          ConditionExpression: categoryExpressions.join(' AND '), ExpressionAttributeNames: categoryNames, ExpressionAttributeValues: categoryValues } });
        categories.add(product.categoryId);
      }
    }
    const result = { schemaVersion: 1, kind: 'SERVER_GOODS_PRICE_PROPOSAL', sourceContract: 'SIMPLE_MANUAL_PRODUCTS_IQD_V1', branchId, lines, goodsGross };
    // Order-independent identity: reordering selectors must not create a different economic proposal.
    const fingerprint = quoteHash({ ...result, lines: [...lines].sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0) });
    return copy({ ...result, fingerprint, conditions, performsWrites: false, requiresAtomicComposition: true,
      requiresBranchAndAccountGuards: true, completeFinancialSnapshot: false });
  } });
}
