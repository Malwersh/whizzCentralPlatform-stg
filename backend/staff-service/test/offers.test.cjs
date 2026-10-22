const { test } = require("node:test");
const assert = require("node:assert/strict");
const { route, validate, normalize, revision } = require("../offers");
const admin = {
  employeeId: "admin",
  status: "ACTIVE",
  roles: ["bootstrap_admin"],
  scope: { allRegions: true },
};
const manager = {
  ...admin,
  roles: ["promotions_manager"],
  scope: { allRegions: false, regionIds: ["r1"] },
};
const approver = { ...admin, roles: ["promotions_approver"] };
const input = () => ({
  id: "offer_one",
  source: "campaign",
  title: "Lunch offer",
  code: "",
  description: "A saving for lunch",
  type: "percentage",
  value: 20,
  minimumOrder: 10000,
  maximumSavings: 5000,
  startAt: "2026-01-01T00:00:00.000Z",
  endAt: "2090-01-01T00:00:00.000Z",
  status: "draft",
  audience: ["all"],
  regionIds: [],
  merchantIds: [],
  itemIds: [],
  categoryIds: [],
  applicability: "allItems",
  usageLimit: 0,
  perCustomerLimit: null,
  singleUse: false,
  firstOrderOnly: false,
});
function fixture() {
  const rows = {
      WhizzMerchants_Businesses: [
        {
          businessId: "m1",
          regionId: "r1",
          businessName: "Merchant one",
          isActive: true,
        },
        { businessId: "m2", regionId: "r2", businessName: "Merchant two" },
      ],
      WizzCentral_Regions: [
        { regionId: "r1", name: "Najaf" },
        { regionId: "r2", name: "Other" },
      ],
      WhizzMerchants_Products: [
        {
          productId: "p1",
          businessId: "m1",
          categoryId: "cat1",
          price: 12000,
          isAvailable: true,
        },
        { productId: "p2", businessId: "m2" },
      ],
      WhizzMerchants_Categories: [
        { categoryId: "cat1", businessId: "m1", isActive: true },
      ],
      WizzCentral_Platform_Discounts: [],
      WhizzMerchants_Discounts: [],
    },
    writes = [];
  const ctx = {
    table: "staff",
    query: {},
    guard: () => ({ ConditionCheck: {} }),
    audit: () => ({ Put: {} }),
    db: {
      send: async (cmd) => {
        const p = cmd.input;
        if (cmd.constructor.name === "ScanCommand")
          return { Items: rows[p.TableName] || [] };
        if (cmd.constructor.name === "GetCommand")
          return {
            Item: (rows[p.TableName] || []).find((row) =>
              Object.entries(p.Key).every(([k, v]) => row[k] === v),
            ),
          };
        if (cmd.constructor.name === "TransactWriteCommand") {
          writes.push(p);
          return {};
        }
        throw Error(cmd.constructor.name);
      },
    },
  };
  return { rows, writes, ctx };
}
const save = (f, actor, data) =>
  route(f.ctx, actor, "POST", "/staff/offers/save", data);
test("optional code and exact IQD precision are supported", () => {
  assert.equal(validate(input()).code, "");
  assert.throws(() => validate({ ...input(), value: 1.0001 }), /decimal/);
  assert.throws(() => validate({ ...input(), value: 101 }), /discount value/);
  assert.throws(
    () => validate({ ...input(), startAt: "not a date" }),
    /End time/,
  );
});
test("publishing rejects exhausted offers and unavailable item selections", async () => {
  const f = fixture();
  await assert.rejects(
    save(f, admin, {
      ...input(),
      source: "merchant",
      merchantIds: ["m1"],
      status: "active",
      applicability: "specificItems",
      itemIds: ["p1"],
      endAt: "2000-01-01T00:00:00.000Z",
    }),
    /End time|expired/,
  );
  f.rows.WhizzMerchants_Products[0].isAvailable = false;
  await assert.rejects(
    save(f, admin, {
      ...input(),
      source: "merchant",
      merchantIds: ["m1"],
      status: "active",
      applicability: "specificItems",
      itemIds: ["p1"],
    }),
    /None of the selected products/,
  );
  f.rows.WizzCentral_Platform_Discounts.push({
    discountId: "offer_one",
    discountSource: "campaign",
    usage: 5,
    currentUsage: 5,
  });
  await assert.rejects(
    save(f, admin, {
      ...input(),
      status: "active",
      usageLimit: 5,
      baseRevision: revision(f.rows.WizzCentral_Platform_Discounts[0]),
    }),
    /usage limit/,
  );
  assert.equal(f.writes.length, 0);
});
test("guest customer history and empty item targeting are rejected", () => {
  assert.throws(
    () => validate({ ...input(), audience: ["guests"], singleUse: true }),
    /signed-in/,
  );
  assert.throws(
    () =>
      validate({
        ...input(),
        merchantIds: ["m1"],
        applicability: "specificItems",
      }),
    /at least one/,
  );
});
test("platform saves maintain aliases without resetting redemption counters", async () => {
  const f = fixture();
  await save(f, admin, input());
  const update = f.writes[0].TransactItems.find(
    (t) => t.Update?.TableName === "WizzCentral_Platform_Discounts",
  ).Update;
  const fields = Object.values(update.ExpressionAttributeNames);
  assert(!fields.includes("usage"));
  assert(!fields.includes("currentUsage"));
  assert(fields.includes("maxDiscountAmount"));
  assert(fields.includes("firstOrderOnly"));
  assert(fields.includes("perCustomerLimit"));
  assert(fields.includes("validFrom"));
  assert(
    update.ConditionExpression.includes("attribute_not_exists(discountId)"),
  );
});
test("merchant fixed discounts use the runtime fixedAmount type and real merchant table", async () => {
  const f = fixture();
  await save(f, admin, {
    ...input(),
    source: "merchant",
    merchantIds: ["m1"],
    type: "fixed",
    value: 2000,
  });
  const u = f.writes[0].TransactItems.find(
    (t) => t.Update?.TableName === "WhizzMerchants_Discounts",
  ).Update;
  const key = Object.entries(u.ExpressionAttributeNames).find(
    ([, v]) => v === "type",
  )[0];
  assert.equal(
    u.ExpressionAttributeValues[key.replace("#f", ":f")],
    "fixedAmount",
  );
  assert(
    Object.values(u.ExpressionAttributeNames).includes("minimum_order_amount"),
  );
});
test("manager can save a scoped draft but cannot publish", async () => {
  const f = fixture();
  await save(f, manager, { ...input(), regionIds: ["r1"] });
  await assert.rejects(
    save(f, manager, { ...input(), regionIds: ["r1"], status: "active" }),
    /approval/,
  );
  await assert.rejects(save(f, manager, input()), /assigned scope/);
});
test("catalogue and item selection cannot cross merchant or region boundaries", async () => {
  const f = fixture();
  await assert.rejects(
    save(f, manager, {
      ...input(),
      source: "merchant",
      merchantIds: ["m2"],
      regionIds: ["r1"],
    }),
    /assigned regions/,
  );
  await assert.rejects(
    save(f, admin, {
      ...input(),
      merchantIds: ["m1"],
      applicability: "specificItems",
      itemIds: ["p2"],
    }),
    /no longer available/,
  );
  f.ctx.query = { merchantId: "m2" };
  await assert.rejects(
    route(f.ctx, manager, "GET", "/staff/offers/catalog", {}),
    /assigned regions/,
  );
});
test("stale editors fail without writing, redemption alone does not change the revision", async () => {
  const f = fixture(),
    row = {
      discountId: "offer_one",
      title: "Existing",
      type: "percentage",
      value: 20,
      status: "draft",
      updatedAt: "v1",
      usage: 2,
      currentUsage: 2,
    };
  f.rows.WizzCentral_Platform_Discounts.push(row);
  assert.equal(revision(row), revision({ ...row, usage: 3, currentUsage: 3 }));
  await assert.rejects(
    save(f, admin, { ...input(), source: "platform", baseRevision: "old" }),
    /another window/,
  );
  assert.equal(f.writes.length, 0);
  await save(f, admin, {
    ...input(),
    source: "platform",
    baseRevision: revision(row),
  });
  const u = f.writes[0].TransactItems.find(
    (t) => t.Update?.TableName === "WizzCentral_Platform_Discounts",
  ).Update;
  assert(u.ConditionExpression.includes("attribute_not_exists(#ev)"));
});
test("approver may change status but may not edit offer contents", async () => {
  const f = fixture(),
    row = {
      discountId: "offer_one",
      discountSource: "campaign",
      title: "Existing",
      code: "",
      type: "percentage",
      value: 20,
      status: "draft",
      validFrom: input().startAt,
      validTo: input().endAt,
    };
  f.rows.WizzCentral_Platform_Discounts.push(row);
  await assert.rejects(
    save(f, approver, { ...input(), baseRevision: revision(row) }),
    /permission to save/,
  );
  await route(f.ctx, approver, "POST", "/staff/offers/status", {
    id: row.discountId,
    source: "campaign",
    baseRevision: revision(row),
    status: "active",
  });
  assert.equal(f.writes.length, 1);
});
test("existing codes are unique and new codes claim an atomic ownership key", async () => {
  const f = fixture();
  f.rows.WizzCentral_Platform_Discounts.push({
    discountId: "another",
    code: "SAVE",
  });
  await assert.rejects(
    save(f, admin, { ...input(), code: "SAVE" }),
    /already in use/,
  );
  await save(f, admin, { ...input(), code: "LUNCH" });
  assert(
    f.writes[0].TransactItems.some(
      (t) => t.Update?.Key?.pk === "OFFER_CODE#LUNCH",
    ),
  );
});
test("read-only staff see scoped data and no mutation controls", async () => {
  const f = fixture();
  f.rows.WizzCentral_Platform_Discounts.push(
    { discountId: "global", title: "Global" },
    { discountId: "local", targetRegionIds: ["r1"] },
  );
  f.rows.WhizzMerchants_Discounts.push({
    discountId: "merchant",
    businessId: "m2",
  });
  const actor = { ...manager, roles: ["platform_manager"] };
  const result = await route(f.ctx, actor, "GET", "/staff/offers", {});
  assert.deepEqual(
    result.offers.map((o) => o.id),
    ["local"],
  );
  assert.equal(result.permissions.create, false);
  assert.equal(result.merchants.length, 1);
  await assert.rejects(
    save(f, actor, { ...input(), regionIds: ["r1"] }),
    /permission/,
  );
});
test("legacy unsupported offers are preserved and cannot be silently weakened", async () => {
  const f = fixture(),
    row = {
      discountId: "offer_one",
      type: "percentage",
      value: 20,
      customerIds: ["private-user"],
      status: "draft",
    };
  f.rows.WizzCentral_Platform_Discounts.push(row);
  assert.equal(normalize(row).unsupported, true);
  assert.equal(
    normalize({
      discountId: "fixed",
      businessId: "m1",
      type: "fixedAmount",
      applicability: "minimumOrder",
    }).type,
    "fixed",
  );
  await assert.rejects(
    save(f, admin, {
      ...input(),
      source: "platform",
      baseRevision: revision(row),
    }),
    /unsupported conditions/,
  );
  assert.equal(f.writes.length, 0);
});

test('campaign image keys reject URLs and malformed paths', () => {
  for (const imageKey of ['https://example.com/image.jpg', '../image.jpg', 12]) {
    assert.throws(() => validate({...input(), imageKey}), /campaign image/);
  }
  assert.equal(validate({...input(), imageKey:'home-slideshow/admin/image.jpg'}).imageKey,'home-slideshow/admin/image.jpg');
});
test('campaign image save checks ownership and metadata and preserves storage key', async () => {
  const {ctx,writes} = fixture();
  const imageKey = 'home-slideshow/admin/image.jpg';
  ctx.assets = {head:async()=>({ContentType:'image/jpeg',ContentLength:1000}),url:async()=> 'https://signed.example/image'};
  await assert.rejects(route(ctx,admin,'POST','/staff/offers/save',{...input(),imageKey:'home-slideshow/another/image.jpg'}),/own account/);
  assert.equal(writes.length,0);
  ctx.assets.head = async()=>({ContentType:'text/html',ContentLength:1000});
  await assert.rejects(route(ctx,admin,'POST','/staff/offers/save',{...input(),imageKey}),/unavailable/);
  ctx.assets.head = async()=>({ContentType:'image/jpeg',ContentLength:1000});
  await route(ctx,admin,'POST','/staff/offers/save',{...input(),imageKey});
  const update = writes[0].TransactItems.find(x=>x.Update?.TableName==='WizzCentral_Platform_Discounts').Update;
  const saved = {};
  for (const [alias,field] of Object.entries(update.ExpressionAttributeNames)) { if(alias.startsWith('#f')) saved[field]=update.ExpressionAttributeValues[':f'+alias.slice(2)]; }
  assert.equal(saved.imageKey,imageKey);
  assert.equal(normalize(saved).imageKey,imageKey);
  assert.equal(saved.imageUrl,undefined);
});
