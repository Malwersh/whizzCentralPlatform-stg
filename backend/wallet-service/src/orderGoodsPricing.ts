import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Money, addMoney, moneyFromMinor, multiplyMoney, parseIqd } from './money';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';

import {readBranchProductOptions,readBranchOptionSelection} from './branchProductOptions';

type Row = Record<string, any>;
const TABLE = 'WhizzMerchants_Products';
const PLATFORM = 'staging-MerchantPlatform';
// The two existing manual product writers store price in IQD in this table, not order pricing's minor units.
const knownFields = ['productId', 'businessId', 'globalProductId', 'name', 'description', 'price', 'categoryId',
  'imageUrl', 'barcode', 'isAvailable', 'searchableName', 'createdAt', 'updatedAt',
  'optionGroups', 'imageUrls', 'images', 'nutritionalInfo', 'allergens', 'preparationTime', 'rating', 'reviewCount','publishedCategory'];
const unsupported = ['stock', 'inventory', 'trackInventory', 'unit', 'unitPrice', 'salePrice', 'discountPrice',
  'options', 'modifiers', 'variants', 'sizes', 'isDeleted', 'deletedAt', 'deletionStatus', 'isActive'];
const fencedFields = ['productId', 'businessId', 'price', 'categoryId', 'isAvailable', 'updatedAt', 'optionGroups', ...unsupported];
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
/** Internal server price source for the branch product and explicit option-group contracts. No HTTP,
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
      const hasSelection=!!raw&&typeof raw==='object'&&Object.prototype.hasOwnProperty.call(raw,'selectedOptions');
      const item = exact(raw, ['productId', 'quantity',...(hasSelection?['selectedOptions']:[])]);
      let selectedOptions:Record<string,string[]>|undefined;
      try { if(hasSelection){selectedOptions=readBranchOptionSelection(item.selectedOptions);for(const key of Object.keys(selectedOptions))if(!selectedOptions[key].length)delete selectedOptions[key];if(!Object.keys(selectedOptions).length)selectedOptions=undefined;} } catch { return fail('INVALID_GOODS_SELECTION'); }
      if (!quoteEntityIdValid(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) return fail('INVALID_GOODS_SELECTION');
      return { productId: item.productId as string, quantity: item.quantity as number,...(selectedOptions?{selectedOptions}:{}) };
    });
    if (new Set(selections.map(i => quoteHash({productId:i.productId,selectedOptions:i.selectedOptions??{}}))).size !== selections.length) return fail('INVALID_GOODS_SELECTION');
    let activeMenu:Row|undefined;
    try { activeMenu=(await options.db.send(new GetCommand({TableName:PLATFORM,Key:{pk:'BRANCH#'+branchId,sk:'MENU_VERSION#ACTIVE'},ConsistentRead:true}))).Item; }
    catch { return fail('GOODS_PRICING_UNAVAILABLE'); }
    const publishedVersion=typeof activeMenu?.publishedVersion==='string'?activeMenu.publishedVersion:undefined;
    const lines: Row[] = [];
    const products = new Map<string,Row>(), pinnedProducts=new Set<string>();
    const conditions: Row[] = [], categories = new Set<string>();
    let goodsGross = moneyFromMinor(0), conditionBytes = 0, usesOptionCatalog = false;
    for (const item of selections) {
      let product: Row | undefined;
      try {
        if(products.has(item.productId))product=products.get(item.productId);
        else if(publishedVersion){const snapshot=(await options.db.send(new GetCommand({TableName:PLATFORM,Key:{pk:'BRANCH#'+branchId,sk:`MENU_VERSION#${publishedVersion}#PRODUCT#${item.productId}`},ConsistentRead:true}))).Item;product=snapshot?.version===publishedVersion?snapshot.product:undefined;}
        else product=(await options.db.send(new GetCommand({ TableName: TABLE, Key: { productId: item.productId }, ConsistentRead: true }))).Item;
        if(product)products.set(item.productId,product);
      }
      catch { return fail('GOODS_PRICING_UNAVAILABLE'); }
      if (!product || product.productId !== item.productId || product.businessId !== branchId || product.isAvailable !== true) return fail('GOODS_UNAVAILABLE');
      // An unfamiliar schema may carry additional pricing or inventory constraints. Never silently drop it.
      if (Object.keys(product).some(k => !knownFields.includes(k)) || !quoteEntityIdValid(product.categoryId)) return fail('GOODS_PRICING_UNSUPPORTED');
      let unitPrice: Money, lineTotal: Money;
      try {
        if (typeof product.price !== 'number' || !Number.isFinite(product.price) || product.price <= 0 || product.price > 1000000000) return fail('GOODS_PRICING_UNSUPPORTED');
        // Convert decimal text exactly, with at most three decimals. No floating multiplication/rounding.
        unitPrice = parseIqd(String(product.price));
        const groups=readBranchProductOptions(product.optionGroups===undefined?[]:product.optionGroups);
        usesOptionCatalog ||= groups.length>0;
        const selected=item.selectedOptions??{};
        if(Object.keys(selected).some(id=>!groups.some(g=>g.id===id)))return fail('INVALID_GOODS_SELECTION');
        for(const group of groups){
          const ids=selected[group.id]??[];
          if((group.required&&ids.length===0)||ids.length>group.maxSelections)return fail('INVALID_GOODS_SELECTION');
          for(const id of ids){
            const option=group.options.find((o:Row)=>o.id===id);
            if(!option||option.isAvailable!==true)return fail('GOODS_UNAVAILABLE');
            unitPrice=addMoney(unitPrice,parseIqd(String(option.extraPrice)));
          }
        }

        lineTotal = multiplyMoney(unitPrice, item.quantity, 1, 'EXACT');
        goodsGross = addMoney(goodsGross, lineTotal);
      } catch (error) { if(error instanceof OrderGoodsPricingError)throw error;return fail('GOODS_PRICING_UNSUPPORTED'); }
      const names: Row = {}, values: Row = {}, expressions: string[] = [];
      for (const [i, field] of fencedFields.entries()) {
        const alias = '#g' + i; names[alias] = field;
        if (product[field] === undefined) expressions.push(`attribute_not_exists(${alias})`);
        else { values[':g' + i] = copy(product[field]); expressions.push(`${alias} = :g${i}`); }
      }
      const condition = publishedVersion?{ConditionCheck:{TableName:PLATFORM,Key:{pk:'BRANCH#'+branchId,sk:`MENU_VERSION#${publishedVersion}#PRODUCT#${item.productId}`},ConditionExpression:'#version=:version AND attribute_exists(#product)',ExpressionAttributeNames:{'#version':'version','#product':'product'},ExpressionAttributeValues:{':version':publishedVersion}}}:{ ConditionCheck: { TableName: TABLE, Key: { productId: item.productId },
        ConditionExpression: expressions.join(' AND '), ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
      if(!pinnedProducts.has(item.productId)){
      conditionBytes += Buffer.byteLength(JSON.stringify(condition));
      if (conditionBytes > 200000) return fail('GOODS_PRICING_UNSUPPORTED');
      conditions.push(condition);pinnedProducts.add(item.productId);
      }
      lines.push({ ...item,...(item.selectedOptions?{lineId:'CONFIG#'+quoteHash({productId:item.productId,selectedOptions:item.selectedOptions})}:{}),unitPrice,lineTotal });
      if (!categories.has(product.categoryId)) {
        const categoryFields = ['categoryId', 'businessId', 'isActive', 'is_active'];
        const categoryNames = Object.fromEntries(categoryFields.map((f, i) => ['#c' + i, f]));
        let category: Row | undefined;
        try { category=publishedVersion?product.publishedCategory:(await options.db.send(new GetCommand({ TableName: 'WhizzMerchants_Categories',
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
        if(!publishedVersion)conditions.push({ ConditionCheck: { TableName: 'WhizzMerchants_Categories', Key: { categoryId: product.categoryId },
          ConditionExpression: categoryExpressions.join(' AND '), ExpressionAttributeNames: categoryNames, ExpressionAttributeValues: categoryValues } });
        categories.add(product.categoryId);
      }
    }
    if(publishedVersion)conditions.unshift({ConditionCheck:{TableName:PLATFORM,Key:{pk:'BRANCH#'+branchId,sk:'MENU_VERSION#ACTIVE'},ConditionExpression:'publishedVersion=:version',ExpressionAttributeValues:{':version':publishedVersion}}});
    const result = { schemaVersion: 1, kind: 'SERVER_GOODS_PRICE_PROPOSAL', sourceContract: usesOptionCatalog?'BRANCH_PRODUCTS_OPTIONS_IQD_V1':'SIMPLE_MANUAL_PRODUCTS_IQD_V1', branchId, lines, goodsGross };
    // Order-independent identity: reordering selectors must not create a different economic proposal.
    const fingerprint = quoteHash({ ...result, lines: [...lines].sort((a, b) => (a.lineId??a.productId).localeCompare(b.lineId??b.productId)) });
    return copy({ ...result, fingerprint, conditions, performsWrites: false, requiresAtomicComposition: true,
      requiresBranchAndAccountGuards: true, completeFinancialSnapshot: false });
  } });
}
