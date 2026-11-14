"use strict";
const {
  GetCommand,
  ScanCommand,
  TransactWriteCommand,
} = require("@aws-sdk/lib-dynamodb");
const { randomUUID, createHash } = require("crypto");
const { allowed } = require("./catalog");
const tables = {
  merchant: "WhizzMerchants_Discounts",
  platform: "WizzCentral_Platform_Discounts",
  campaign: "WizzCentral_Platform_Discounts",
};
const {versioned}=require('./campaign-version');
const {patchTerms}=require('./discount-contract');
const MERCHANTS = "WhizzMerchants_Businesses",
  REGIONS = "WizzCentral_Regions",
  PRODUCTS = "WhizzMerchants_Products",
  CATEGORIES = "WhizzMerchants_Categories";
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status });
const validId = (v) => typeof v === "string" && /^[\w-]{1,150}$/.test(v);
const validSource = (v) => typeof v === "string" && Object.hasOwn(tables, v);
const instant = (v) => {
  if (!v) return "";
  const value = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(v)
    ? v + "+03:00"
    : v;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : v;
};
const text = (v, max = 300) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const list = (v) => (Array.isArray(v) ? [...new Set(v)] : []);
const get = async (ctx, TableName, Key) =>
  (await ctx.db.send(new GetCommand({ TableName, Key, ConsistentRead: true })))
    .Item;
async function scan(ctx, TableName) {
  let rows = [],
    cursor;
  for (let n = 0; n < 100; n++) {
    const r = await ctx.db.send(
      new ScanCommand({
        TableName,
        ExclusiveStartKey: cursor,
        ConsistentRead: true,
      }),
    );
    rows.push(...(r.Items || []));
    cursor = r.LastEvaluatedKey;
    if (!cursor) return rows;
  }
  throw fail("Could not load the complete catalogue. Please try again.", 503);
}
const source = (row) =>
  row.businessId
    ? "merchant"
    : row.discountSource === "campaign"
      ? "campaign"
      : "platform";
const revision = (row) =>
  row
    ? createHash("sha256")
        .update(
          JSON.stringify(
            Object.fromEntries(
              Object.keys(row)
                .sort()
                .filter(
                  (k) =>
                    ![
                      "usage",
                      "currentUsage",
                      "usage_count",
                      "usageCount",
                    ].includes(k),
                )
                .map((k) => [k, row[k]]),
            ),
          ),
        )
        .digest("hex")
    : null;
function inScope(actor, row, merchants) {
  if (actor.scope?.allRegions === true) return true;
  if (row.businessId)
    return merchants.some(
      (m) =>
        m.businessId === row.businessId &&
        actor.scope?.regionIds?.includes(m.regionId),
    );
  const ids = row.targetRegionIds || [];
  return (
    ids.length > 0 && ids.every((id) => actor.scope?.regionIds?.includes(id))
  );
}
function normalize(row) {
  const type =
    {
      fixedAmount: "fixed",
      fixed_amount: "fixed",
      free_delivery: "freeDelivery",
      "free-delivery": "freeDelivery",
      "Free Delivery": "freeDelivery",
      "Fixed Amount": "fixed",
      Percentage: "percentage",
    }[row.type || row.discountType] ||
    row.type ||
    row.discountType ||
    "percentage";
  return {
    id: row.discountId,
    source: source(row),
    revision: revision(row),
    title: row.title || row.name || row.code || row.discountId,
    code: row.code || "",
    description: row.description || "",
    imageKey: row.imageKey || "",
    type,
    value: row.value ?? row.discountValue ?? 0,
    minimumOrder:
      row.minimumOrderAmount ??
      row.minimum_order_amount ??
      row.minOrderAmount ??
      row.minOrderValue ??
      0,
    maximumSavings: row.maxDiscountAmount ?? row.maxDiscount ?? null,
    startAt: instant(row.validFrom || row.valid_from || row.startDate),
    endAt: instant(row.validTo || row.valid_to || row.endDate),
    status:
      row.isActive === false && row.status === "active"
        ? "paused"
        : row.status || "draft",
    audience: row.customerSegments || ["all"],
    regionIds: row.targetRegionIds || [],
    merchantIds: row.businessId
      ? [row.businessId]
      : row.targetRestaurants?.length
        ? row.targetRestaurants
        : row.allowedBusinessIds?.length
          ? row.allowedBusinessIds
          : row.businessIds || [],
    applicability:
      row.applicability === "minimumOrder"
        ? "allItems"
        : row.applicability || "allItems",
    itemIds: row.applicable_item_ids || [],
    categoryIds: row.applicable_category_ids || [],
    firstOrderOnly:
      row.firstOrderOnly === true ||
      ["first-order", "first_order"].includes(row.campaignType),
    campaignType:
      { first_order: "first-order", new_customer: "new-customer" }[
        row.campaignType
      ] ||
      ([
        "first-order",
        "new-customer",
        "loyalty",
        "promotional",
        "seasonal",
      ].includes(row.campaignType)
        ? row.campaignType
        : "promotional"),
    singleUse: row.singleUse === true,
    perCustomerLimit: row.perCustomerLimit ?? null,
    usage:
      row.usage_count ?? row.usageCount ?? row.usage ?? row.currentUsage ?? 0,
    usageLimit: row.usageLimit ?? row.usage_limit ?? row.limit ?? 0,
    unsupported:
      !["percentage", "fixed", "freeDelivery"].includes(type) ||
      !!(
        row.targetSegments?.length ||
        row.occasions?.length ||
        (row.targetLocation && !row.targetRegionIds?.length) ||
        row.stackable === true ||
        row.customerIds?.length ||
        Object.keys(
          row.conditionalParameters || row.conditional_parameters || {},
        ).length
      ),
  };
}
function validate(input) {
  if (input?.imageKey != null && (typeof input.imageKey !== 'string' || (input.imageKey && !/^home-slideshow\/[\w-]+\/[\w-]+\.(?:jpg|gif)$/.test(input.imageKey)))) throw fail('Upload a valid campaign image.');
  if (!input || !validSource(input.source) || !validId(input.id))
    throw fail("Choose a valid offer source.");
  if (
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 100
  )
    throw fail("Enter an offer title, up to 100 characters.");
  if (
    typeof input.code !== "string" ||
    input.code.length > 40 ||
    (input.code && !/^[A-Z0-9_-]+$/.test(input.code))
  )
    throw fail("Codes use uppercase letters, numbers, underscores or hyphens.");
  if (!["percentage", "fixed", "freeDelivery"].includes(input.type))
    throw fail("Choose a supported discount type.");
  const number = (v, min, max, label, integer = false) => {
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer
        ? !Number.isSafeInteger(v)
        : !/^\d+(?:\.\d{1,3})?$/.test(String(v)))
    )
      throw fail(
        "Check " + label + ". Use at most three decimal places for amounts.",
      );
    return v;
  };
  const value =
    input.type === "freeDelivery"
      ? 0
      : number(
          input.value,
          0.001,
          input.type === "percentage" ? 100 : 1000000000,
          "discount value",
        );
  number(input.minimumOrder, 0, 1000000000, "minimum order");
  if (input.maximumSavings != null)
    number(input.maximumSavings, 0.001, 1000000000, "maximum savings");
  number(input.usageLimit, 0, 1000000000, "total usage limit", true);
  if (input.perCustomerLimit != null)
    number(input.perCustomerLimit, 1, 1000000, "per-customer limit", true);
  const instant = (v) =>
    typeof v === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v) &&
    Number.isFinite(Date.parse(v));
  if (
    !instant(input.startAt) ||
    !instant(input.endAt) ||
    Date.parse(input.endAt) <= Date.parse(input.startAt)
  )
    throw fail("End time must be after start time.");
  if (!["draft", "active", "paused"].includes(input.status))
    throw fail("Choose draft, active or paused.");
  if (
    input.campaignType != null &&
    ![
      "first-order",
      "new-customer",
      "loyalty",
      "promotional",
      "seasonal",
    ].includes(input.campaignType)
  )
    throw fail("Choose a supported campaign purpose.");
  for (const key of ["regionIds", "merchantIds", "itemIds", "categoryIds"])
    if (
      !Array.isArray(input[key]) ||
      input[key].length > 100 ||
      input[key].some((v) => !validId(v))
    )
      throw fail("Choose valid " + key + ".");
  if (
    !Array.isArray(input.audience) ||
    input.audience.length !== 1 ||
    ![
      "all",
      "registered",
      "guests",
      "new",
      "returning",
      "inactive",
      "vip",
    ].includes(input.audience[0])
  )
    throw fail("Choose one customer audience.");
  if (
    input.audience[0] === "guests" &&
    (input.firstOrderOnly ||
      input.singleUse ||
      input.perCustomerLimit != null ||
      ["new-customer", "new_customer", "first-order", "first_order"].includes(
        input.campaignType,
      ))
  )
    throw fail(
      "Customer history and per-customer limits require a signed-in customer.",
    );
  if (
    !["allItems", "specificItems", "specificCategories"].includes(
      input.applicability,
    )
  )
    throw fail("Choose all items, selected items or selected categories.");
  if (input.source === "merchant" && input.merchantIds.length !== 1)
    throw fail("Choose one merchant for a merchant discount.");
  if (input.applicability !== "allItems" && input.merchantIds.length !== 1)
    throw fail("Select one merchant before targeting items or categories.");
  if (
    (input.applicability === "specificItems" && !input.itemIds.length) ||
    (input.applicability === "specificCategories" && !input.categoryIds.length)
  )
    throw fail("Select at least one eligible item or category.");
  return {
    ...input,
    title: input.title.trim(),
    description: text(input.description, 2000),
    value,
  };
}
async function route(ctx, actor, method, path, input) {
  if (!allowed(actor, "promotions.read"))
    throw fail("You do not have permission to view promotions.", 403);
  const merchants = (await scan(ctx, MERCHANTS)).filter(
    (m) => !m.isDeleted && !m.deletedAt,
  );
  const visible = merchants.filter(
    (m) =>
      actor.scope?.allRegions === true ||
      actor.scope?.regionIds?.includes(m.regionId),
  );
  if (method === "GET" && path === "/staff/offers/catalog") {
    const merchantId = ctx.query?.merchantId;
    if (
      !validId(merchantId) ||
      !visible.some((m) => m.businessId === merchantId)
    )
      throw fail("Merchant is outside your assigned regions.", 403);
    const [categories, products] = await Promise.all([
      scan(ctx, CATEGORIES),
      scan(ctx, PRODUCTS),
    ]);
    return {
      categories: categories
        .filter(
          (c) =>
            (c.businessId || c.business_id) === merchantId &&
            !c.isDeleted &&
            !c.deletedAt,
        )
        .map((c) => ({
          id: c.categoryId,
          label: c.name_ar || c.categoryName || c.name || c.categoryId,
          available: c.isActive !== false && c.is_active !== false,
        })),
      products: products
        .filter(
          (p) => p.businessId === merchantId && !p.isDeleted && !p.deletedAt,
        )
        .map((p) => ({
          id: p.productId,
          label: p.name_ar || p.name || p.productName || p.productId,
          categoryId: p.categoryId,
          price: p.price,
          available: p.isAvailable === true,
        })),
    };
  }
  if (method === "GET" && path === "/staff/offers") {
    const [platform, merchant, regions] = await Promise.all([
      scan(ctx, tables.platform),
      scan(ctx, tables.merchant),
      scan(ctx, REGIONS),
    ]);
    return {
      offers: await Promise.all([...platform, ...merchant]
        .filter(
          (r) => !r.benefit && !r.isDeleted && !r.deletedAt && inScope(actor, r, merchants),
        )
        .map(async row => {const offer=normalize(row),sharing=await require('./shared-discount-lock').read(ctx.db,offer.source==='merchant'?'MERCHANT':'PLATFORM',row); return {...offer,sharingLocked:sharing.locked,sharingCanActivate:sharing.initiallyInactive&&!row.sharedStopped,imageUrl:offer.imageKey?await require('./home-slideshow').assets(ctx).url(offer.imageKey):''};})),
      merchants: visible.map((m) => ({
        id: m.businessId,
        label: m.businessName || m.businessNameArabic || m.name || m.businessId,
        regionId: m.regionId,
        available: m.isActive !== false && !m.platformSuspended,
      })),
      regions: regions
        .filter(
          (r) =>
            actor.scope?.allRegions === true ||
            actor.scope?.regionIds?.includes(r.regionId),
        )
        .map((r) => ({
          id: r.regionId,
          label:
            [r.name_ar, r.name_en || r.name].filter(Boolean).join(" / ") ||
            r.regionId,
          parentId: r.parent_id,
        })),
      permissions: {
        create: allowed(actor, "promotions.create"),
        edit: allowed(actor, "promotions.edit"),
        approve: allowed(actor, "promotions.approve"),
        allRegions: actor.scope?.allRegions === true,
      },
    };
  }
  if (
    method !== "POST" ||
    !["/staff/offers/save", "/staff/offers/status"].includes(path)
  )
    throw fail("NOT_FOUND", 404);
  if (!validSource(input.source) || !validId(input.id))
    throw fail("Invalid offer.");
  const table = tables[input.source],
    before = await get(ctx, table, { discountId: input.id });
  if(before?.benefit)throw fail('BENEFIT_EDITOR_REQUIRED',409);
  if (
    before &&
    (!inScope(actor, before, merchants) || source(before) !== input.source)
  )
    throw fail("Offer is outside your assigned scope.", 403);
  if ((before ? revision(before) : null) !== (input.baseRevision ?? null))
    throw fail(
      "This offer changed in another window. Reload it before saving.",
      409,
    );
  const sharedLocks=require('./shared-discount-lock'),sharing=before?await sharedLocks.read(ctx.db,input.source==='merchant'?'MERCHANT':'PLATFORM',before):null;
  if(sharing?.locked&&!path.endsWith('/status'))throw fail('هذا خصم مشترك معتمد؛ لا يمكن تعديل شروطه. أوقفه وأنشئ بديلًا بموافقة جديدة.',409);
  let data;
  if (path.endsWith("/status")) {
    if (!before) throw fail("Offer not found.", 404);
    if (!allowed(actor, "promotions.approve"))
      throw fail(
        "Publishing and pausing require promotion approval permission.",
        403,
      );
    data = validate({ ...normalize(before), status: input.status });
  } else {
    if (!allowed(actor, before ? "promotions.edit" : "promotions.create"))
      throw fail("You do not have permission to save this offer.", 403);
    data = validate(input);
    if (
      (data.status === "active" || before?.status === "active") &&
      !allowed(actor, "promotions.approve")
    )
      throw fail(
        "Changing an active offer requires promotion approval permission.",
        403,
      );
  }
  if (data.imageKey && data.imageKey !== before?.imageKey) {
    if (!data.imageKey.startsWith(`home-slideshow/${actor.employeeId}/`)) throw fail('Upload an image using your own account.',403);
    const head = await require('./home-slideshow').assets(ctx).head(data.imageKey);
    if (!require('./home-slideshow').validImageMetadata(data.imageKey, head)) throw fail('Uploaded campaign image is unavailable.');
  }
  if (before && normalize(before).unsupported)
    throw fail(
      "This legacy offer has unsupported conditions. Review its existing settings before editing.",
    );
  for (const merchantId of data.merchantIds)
    if (!visible.some((m) => m.businessId === merchantId))
      throw fail("Choose merchants within your assigned regions.", 403);
  if (
    !inScope(
      actor,
      {
        businessId:
          data.source === "merchant" ? data.merchantIds[0] : undefined,
        targetRegionIds: data.regionIds,
      },
      merchants,
    )
  )
    throw fail("Choose regions within your assigned scope.", 403);
  for (const regionId of data.regionIds)
    if (!(await get(ctx, REGIONS, { regionId })))
      throw fail("A selected region no longer exists.");
  if (data.status === "active") {
    if (Date.parse(data.endAt) <= Date.now())
      throw fail(
        "The offer has expired. Choose a future end time before activating it.",
      );
    const used =
      before?.usage_count ??
      before?.usageCount ??
      before?.usage ??
      before?.currentUsage ??
      0;
    if (data.usageLimit > 0 && used >= data.usageLimit)
      throw fail(
        "The offer has reached its usage limit. Increase the limit before activating it.",
      );
    if (
      data.merchantIds.length &&
      !data.merchantIds.some((id) =>
        visible.some(
          (m) =>
            m.businessId === id && m.isActive !== false && !m.platformSuspended,
        ),
      )
    )
      throw fail(
        "No selected merchant is currently available. Save a draft or choose an active merchant.",
      );
  }
  if (data.applicability !== "allItems") {
    for (const [tableName, ids, key] of [
      [
        PRODUCTS,
        data.applicability === "specificItems" ? data.itemIds : [],
        "productId",
      ],
      [
        CATEGORIES,
        data.applicability === "specificCategories" ? data.categoryIds : [],
        "categoryId",
      ],
    ])
      for (const id of ids) {
        const row = await get(ctx, tableName, { [key]: id });
        if (
          !row ||
          (row.businessId || row.business_id) !== data.merchantIds[0] ||
          row.isDeleted ||
          row.deletedAt
        )
          throw fail("An eligible item or category is no longer available.");
      }
    if (data.status === "active") {
      const [products, categories] = await Promise.all([
        scan(ctx, PRODUCTS),
        scan(ctx, CATEGORIES),
      ]);
      const activeCategories = new Set(
        categories
          .filter(
            (c) =>
              (c.businessId || c.business_id) === data.merchantIds[0] &&
              c.isActive !== false &&
              c.is_active !== false &&
              !c.isDeleted &&
              !c.deletedAt,
          )
          .map((c) => c.categoryId),
      );
      const available = products.some(
        (p) =>
          p.businessId === data.merchantIds[0] &&
          p.isAvailable === true &&
          !p.isDeleted &&
          !p.deletedAt &&
          activeCategories.has(p.categoryId) &&
          (data.applicability === "specificItems"
            ? data.itemIds.includes(p.productId)
            : data.categoryIds.includes(p.categoryId)),
      );
      if (!available)
        throw fail(
          "None of the selected products are currently available. Save a draft or select available products.",
        );
    }
  }
  if (data.source !== "merchant" && data.code) {
    const duplicates = (await scan(ctx, tables.platform)).filter(
      (r) =>
        r.discountId !== data.id &&
        r.code === data.code &&
        !r.isDeleted &&
        !r.deletedAt,
    );
    if (duplicates.length) throw fail("This campaign code is already in use.");
  }
  const now = new Date().toISOString(),
    oldVersion = before?.editorVersion ?? 0;
  const common = {
    title: data.title,
    name: data.title,
    code: data.code,
    description: data.description,
    imageKey: data.imageKey ?? before?.imageKey ?? "",
    type: data.type,
    discountType: data.type,
    value: data.value,
    discountValue: data.value,
    status: data.status,
    isActive: data.status === "active",
    autoActivate: data.status === "active",
    customerSegments: data.audience,
    targetRegionIds: list(data.regionIds),
    targetLocation: "",
    target: "",
    targetRestaurants: data.source === "merchant" ? [] : list(data.merchantIds),
    targetSegments: [],
    occasions: [],
    applicableToAll: !data.regionIds.length && !data.merchantIds.length,
    firstOrderOnly: data.firstOrderOnly === true,
    campaignType: data.firstOrderOnly
      ? "first-order"
      : data.campaignType === "first-order" ||
          data.campaignType === "first_order"
        ? "promotional"
        : data.campaignType || "promotional",
    singleUse: data.singleUse === true,
    perCustomerLimit: data.singleUse ? 1 : (data.perCustomerLimit ?? null),
    stackable: false,
    applicability: data.applicability,
    applicable_item_ids:
      data.applicability === "specificItems" ? list(data.itemIds) : [],
    applicable_category_ids:
      data.applicability === "specificCategories" ? list(data.categoryIds) : [],
    maxDiscountAmount: data.maximumSavings ?? null,
    maxDiscount: data.maximumSavings ?? null,
    validFrom: data.startAt,
    validTo: data.endAt,
    startDate: data.startAt,
    endDate: data.endAt,
    usageLimit: data.usageLimit,
    updatedAt: now,
    editorVersion: oldVersion + 1,
  };
  if (data.source === "merchant")
    Object.assign(common, {
      type: data.type === "fixed" ? "fixedAmount" : data.type,
      discountType: data.type === "fixed" ? "fixedAmount" : data.type,
      businessId: data.merchantIds[0],
      minimumOrderAmount: data.minimumOrder,
      minimum_order_amount: data.minimumOrder,
      valid_from: data.startAt,
      valid_to: data.endAt,
      usage_limit: data.usageLimit,
    });
  else
    Object.assign(common, {
      discountSource: data.source,
      minOrderValue: data.minimumOrder,
      minOrderAmount: data.minimumOrder,
      limit: data.usageLimit,
      allowedBusinessIds: [],
      businessIds: [],
    });
  if(sharing?.locked){const state={status:data.status,...(before.isActive!==undefined?{isActive:data.status==='active'}:{}),...(before.autoActivate!==undefined?{autoActivate:data.status==='active'}:{})};const proposed={...before,...state};sharedLocks.assertChange(sharing,before,proposed);for(const k of Object.keys(common))delete common[k];Object.assign(common,state,{[data.source==='merchant'?'updated_at':'updatedAt']:now},proposed.sharedStopped===true?{sharedStopped:true}:{});}
  // Use the existing canonical version contract while retaining the editor API.
  const prior=before?{...before}:null;
  const after=sharing?.locked?{...before,...common}:patchTerms(before,{...common},data.source==='merchant'?'merchant':'platform');
  // Editor revision metadata must not turn a status-only update into a terms edit.
  if(prior)delete prior.editorVersion;
  const terms={...after};delete terms.editorVersion;
  const canonical=versioned(prior,terms);
  common.version=canonical.version;
  const removed=['fundingPolicyId','fundingPolicyVersion'].filter(k=>before?.[k]!==undefined&&canonical[k]===undefined);
  const names = {},
    values = {},
    sets = [],
    conditions = [];
  for (const [i, [k, v]] of Object.entries(common).entries()) {
    names["#f" + i] = k;
    values[":f" + i] = v;
    sets.push("#f" + i + "=:f" + i);
  }
  // Fence every observed non-counter field so legacy editors and usage reservations cannot overwrite one another.
  if (before) {
    for (const [i, [k, v]] of Object.entries(before)
      .filter(
        ([k]) =>
          !["usage", "currentUsage", "usage_count", "usageCount"].includes(k),
      )
      .entries()) {
      names["#b" + i] = k;
      values[":b" + i] = v;
      conditions.push("#b" + i + "=:b" + i);
    }
    for (const k of ['version','fundingPolicyId','fundingPolicyVersion'])if(before[k]===undefined){names['#pin'+k]=k;conditions.push('attribute_not_exists(#pin'+k+')');}
    for (const [i, k] of Object.keys(common)
      .filter((k) => before[k] === undefined && k !== "editorVersion")
      .entries()) {
      names["#abs" + i] = k;
      conditions.push("attribute_not_exists(#abs" + i + ")");
    }
    if (before.editorVersion === undefined) {
      names["#ev"] = "editorVersion";
      conditions.push("attribute_not_exists(#ev)");
    }
  } else conditions.push("attribute_not_exists(discountId)");
  if (!before) {
    names["#created"] = "createdAt";
    values[":created"] = now;
    sets.push("#created=:created");
  }
  const tx = [
    ctx.guard(actor),
    {
      Update: {
        TableName: table,
        Key: { discountId: data.id },
        UpdateExpression: 'SET '+sets.join(', ')+(removed.length?' REMOVE '+removed.map((k,i)=>{names['#remove'+i]=k;return '#remove'+i;}).join(', '):''),
        ConditionExpression: conditions.join(" AND "),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    },
    ctx.audit(
      actor.employeeId,
      "OFFER_SAVED",
      before ? normalize(before) : null,
      { ...data, updatedAt: now },
      randomUUID(),
    ),
  ];
  if(sharing)tx.push(...sharing.guards);
  if (data.source !== "merchant" && data.code)
    tx.push({
      Update: {
        TableName: ctx.table,
        Key: { pk: "OFFER_CODE#" + data.code, sk: "OWNER" },
        UpdateExpression: "SET offerId=:id",
        ConditionExpression: "attribute_not_exists(offerId) OR offerId=:id",
        ExpressionAttributeValues: { ":id": data.id },
      },
    });
  if (before?.code && before.code !== data.code && data.source !== "merchant")
    tx.push({
      Delete: {
        TableName: ctx.table,
        Key: { pk: "OFFER_CODE#" + before.code, sk: "OWNER" },
        ConditionExpression: "attribute_not_exists(offerId) OR offerId=:id",
        ExpressionAttributeValues: { ":id": data.id },
      },
    });
  if (actor.scope?.allRegions !== true)
    for (const id of data.merchantIds) {
      const m = visible.find((m) => m.businessId === id);
      tx.push({
        ConditionCheck: {
          TableName: MERCHANTS,
          Key: { businessId: id },
          ConditionExpression:
            "regionId=:region AND attribute_not_exists(deletedAt)",
          ExpressionAttributeValues: { ":region": m.regionId },
        },
      });
    }
  if(before&&(before.legalHold===true||before.retentionHold===true))throw fail('CAMPAIGN_RETENTION_HOLD',409);
  if (tx.length > 100) throw fail("Choose fewer merchants for this offer.");
  try {
    await ctx.db.send(new TransactWriteCommand({ TransactItems: tx }));
  } catch (e) {
    if (e.name === "TransactionCanceledException")
      throw fail(
        "The offer or code changed. Reload the latest version before saving.",
        409,
      );
    throw e;
  }
  return { saved: true, id: data.id };
}
module.exports = { route, validate, normalize, revision, inScope };
