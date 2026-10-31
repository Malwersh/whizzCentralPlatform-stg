// Runs the real frontend and staff route handlers against in-memory DynamoDB/S3 fixtures.
const fs = require("fs"),
  path = require("path"),
  assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.env.WIZZ_PLATFORM_ROOT || path.resolve(__dirname, ".."),
  offers = require(root + "/backend/staff-service/offers"),
  slideshow = require(root + "/backend/staff-service/home-slideshow");
const artifacts = process.env.WIZZ_PROMOTIONS_ARTIFACTS || root;
fs.mkdirSync(artifacts, {recursive:true});
let actor = {
    employeeId: "admin",
    status: "ACTIVE",
    roles: ["bootstrap_admin"],
    scope: { allRegions: true },
  },
  current = null,
  saveFailure = false,
  conflict = false,
  reportFailure = false,
  requests = [];
const images = new Map(),
  tables = {
    WhizzMerchants_Businesses: [
      {
        businessId: "m1",
        businessName: "Najaf Kitchen",
        regionId: "r1",
        isActive: true,
      },
      {
        businessId: "m2",
        businessName: "Second Kitchen",
        regionId: "r2",
        isActive: true,
      },
    ],
    WizzCentral_Regions: [
      { regionId: "r1", name_ar: "النجف", name: "Najaf" },
      {
        regionId: "r2",
        parent_id: "r1",
        name_ar: "المناذرة",
        name: "Al-Manathirah",
      },
    ],
    WhizzMerchants_Categories: [
      {
        categoryId: "cat1",
        businessId: "m1",
        name_ar: "مشروبات",
        isActive: true,
      },
    ],
    WhizzMerchants_Products: [
      {
        productId: "p1",
        businessId: "m1",
        categoryId: "cat1",
        name: "Tea",
        price: 1000,
        isAvailable: true,
      },
      {
        productId: "p2",
        businessId: "m1",
        categoryId: "cat1",
        name: "Coffee",
        price: 2000,
        isAvailable: false,
      },
    ],
    WhizzMerchants_Discounts: [],
    WizzCentral_Platform_Discounts: [
      {
        discountId: "existing",
        discountSource: "campaign",
        title: "Existing campaign",
        code: "WELCOME",
        type: "percentage",
        value: 10,
        status: "active",
        validFrom: "2020-01-01T00:00:00.000Z",
        validTo: "2090-01-01T00:00:00.000Z",
        usage: 4,
        currentUsage: 4,
        usageLimit: 100,
      },
    ],
  };
const ctx = {
  table: "staff",
  query: {},
  guard: () => ({ ConditionCheck: {} }),
  audit: () => ({ Put: {} }),
  assets: {
    put: async (k, b) => images.set(k, b),
    head: async (k) => ({
      ContentType: "image/jpeg",
      ContentLength: images.get(k)?.length || 100,
    }),
    url: async (k) => "https://fixture.test/images/" + k,
  },
  db: {
    send: async (c) => {
      const p = c.input;
      if (c.constructor.name === "ScanCommand")
        return { Items: tables[p.TableName] || [] };
      if (c.constructor.name === "GetCommand")
        return {
          Item: p.Key.pk
            ? current
            : (tables[p.TableName] || []).find((r) =>
                Object.entries(p.Key).every(([k, v]) => r[k] === v),
              ),
        };
      if (c.constructor.name === "TransactWriteCommand") {
        if (conflict)
          throw Object.assign(Error("conflict"), {
            name: "TransactionCanceledException",
          });
        for (const tx of p.TransactItems) {
          if (tx.Put?.Item?.pk === "HOME_SLIDESHOW") current = tx.Put.Item;
          if (tx.Update && tables[tx.Update.TableName]) {
            const u = tx.Update,
              rows = tables[u.TableName];
            let row = rows.find((r) => r.discountId === u.Key.discountId);
            if (!row) {
              row = { ...u.Key };
              rows.push(row);
            }
            for (const assignment of u.UpdateExpression.replace(
              /^SET /,
              "",
            ).split(", ")) {
              const [k, v] = assignment.split("=");
              row[u.ExpressionAttributeNames[k.trim()] || k.trim()] =
                u.ExpressionAttributeValues[v.trim()];
            }
          }
        }
        return {};
      }
      throw Error(c.constructor.name);
    },
  },
};
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_PATH
      ? { executablePath: process.env.BROWSER_PATH }
      : {}),
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1050 },
        timezoneId: "America/Los_Angeles",
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== "fixture.test")
        return route.fulfill({ body: "", contentType: "text/plain" });
      if (u.pathname.startsWith("/staff/")) {
        try {
          const body = route.request().postDataJSON() || {};
          if (
            u.pathname.endsWith("/save") &&
            u.pathname.includes("/offers") &&
            saveFailure
          )
            return route.fulfill({
              status: 500,
              json: { error: "Save failed. Please retry." },
            });
          if (u.pathname.endsWith("/report") && reportFailure)
            return route.fulfill({
              status: 503,
              json: { error: "Report temporarily unavailable" },
            });
          if (u.pathname === '/staff/promotions') {
            requests.push({path:u.pathname,body});
            if (route.request().method() === 'GET') return route.fulfill({json:{revision:'notification-revision'}});
            if (body.action === 'NOTIFY_STATUS') return route.fulfill({json:{notificationStatus:'NOT_REQUESTED'}});
            assert.equal(body.action,'NOTIFY');
            assert.equal(body.baseRevision,'notification-revision');
            return route.fulfill({json:{notificationStatus:'QUEUED'}});
          }
          requests.push({ path: u.pathname, body });
          ctx.query = Object.fromEntries(u.searchParams);
          const data = await (
            u.pathname.startsWith("/staff/offers") ? offers : slideshow
          ).route(ctx, actor, route.request().method(), u.pathname, body);
          return route.fulfill({ json: data });
        } catch (e) {
          return route.fulfill({
            status: e.status || 500,
            json: { error: e.message },
          });
        }
      }
      if (u.pathname.startsWith("/images/"))
        return route.fulfill({
          contentType: "image/jpeg",
          body:
            images.get(u.pathname.slice("/images/".length)) || Buffer.alloc(0),
        });
      if (u.pathname.endsWith("auth-utils.js"))
        return route.fulfill({
          contentType: "application/javascript",
          body: 'window.Auth={requireAuthentication:()=>true,ensureSession:async()=>{},getToken:()=>"fixture"};',
        });
      if (u.pathname === "/assets/js/rbac.js")
        return route.fulfill({contentType:"application/javascript",body:'window.RBAC={ensure:async()=>{},fetchMe:async()=>({email:"synthetic-editor",roles:["bootstrap_admin"]}),pageAllowed:()=>true,can:()=>true,applyReadOnly:()=>{}};'});
      if (u.pathname === "/config.js")
        return route.fulfill({
          contentType: "application/javascript",
          body: 'window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:"https://fixture.test"};',
        });
      if (
        [
          "/env.js",
          "/styles/wizz-theme-config.js",
        ].includes(u.pathname)
      )
        return route.fulfill({
          body: "",
          contentType: u.pathname.endsWith(".css")
            ? "text/css"
            : "application/javascript",
        });
      const file = path.join(root, "frontend", u.pathname);
      if (!fs.existsSync(file))
        return route.fulfill({ status: 404, body: "Missing fixture asset" });
      return route.fulfill({
        body: fs.readFileSync(file),
        contentType: file.endsWith(".js")
          ? "application/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    });
    await page.goto("https://fixture.test/pages/promotions.html");
    await page.waitForFunction(()=>window.navigationManager?.isInitialized);
    await page.locator("#offer-create:enabled").waitFor();
    assert.equal(await page.locator(".offer-row").count(), 1);
    await page.getByRole('button',{name:'التفاصيل',exact:true}).first().click();
    assert((await page.locator('#offer-detail-content').textContent()).includes('مسؤولية التمويل'));
    await page.getByRole('button',{name:'إرسال إشعار الحملة',exact:true}).waitFor();
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='إرسال إشعار الحملة')?.disabled);
    await page.getByRole('button',{name:'إرسال إشعار الحملة',exact:true}).click();
    await page.getByText('الإشعار في قائمة الإرسال. حدّث الحالة بعد قليل.',{exact:true}).waitFor();
    assert(await page.getByRole('button',{name:'إرسال إشعار الحملة',exact:true}).isDisabled());
    assert.equal(requests.filter(r=>r.body.action==='NOTIFY').length,1);
    await page.locator('#offer-detail-close').click();

    await page.screenshot({
      path: artifacts + "/overview-desktop.png",
      fullPage: true,
    });
    await page.locator("#offer-create").click();
    assert((await page.locator('#offer-funding-summary').textContent()).includes('المنصة'));
    assert((await page.locator('#offer-funding-change').textContent()).includes('لا ينشئ اتفاقية'));
    await page.locator("#edit-title").fill("Lunch for everyone");
    await page.locator("#edit-value").fill("20");
    await page.locator("#edit-minimum").fill("10000");
    await page.locator("#edit-maximum").fill("5000");
    await page.locator("#edit-customer-limit").fill("2");
    await page.locator("#edit-start").fill("2026-10-16T20:00");
    await page.locator("#edit-end").fill("2090-01-01T20:00");
    await page.locator("#edit-all-regions").uncheck();
    await page.locator("#region-search").fill("المناذرة");
    await page.locator("#region-choices input").check();
    saveFailure = true;
    await page.locator("#offer-save").click();
    await page
      .locator("#offer-save-status")
      .filter({ hasText: "تعذّر حفظ العرض" })
      .waitFor();
    assert.equal(
      await page.locator("#edit-title").inputValue(),
      "Lunch for everyone",
    );
    assert.equal(tables.WizzCentral_Platform_Discounts.length, 1);
    saveFailure = false;
    await page.locator("#offer-save").click();
    await page.waitForFunction(
      () => !document.getElementById("offer-dialog").open,
    );
    await page
      .locator(".offer-row")
      .filter({ hasText: "Lunch for everyone" })
      .waitFor();
    const created = tables.WizzCentral_Platform_Discounts.find(
      (o) => o.title === "Lunch for everyone",
    );
    assert(created);
    assert.equal(created.validFrom, "2026-10-16T17:00:00.000Z");
    assert.equal(created.perCustomerLimit, 2);
    assert.equal(created.maxDiscountAmount, 5000);
    assert.deepEqual(created.targetRegionIds, ["r2"]);
    assert.equal(created.code, "");
    assert.equal(created.status, "draft");
    let row = page
      .locator(".offer-row")
      .filter({ hasText: "Lunch for everyone" });
    await row.getByRole("button", { name: "تفعيل", exact: true }).click();
    await row.locator(".status-pill").filter({ hasText: "سارٍ" }).waitFor();
    await row.getByRole("button", { name: "إيقاف مؤقت", exact: true }).click();
    await row.locator(".status-pill").filter({ hasText: "متوقف مؤقتًا" }).waitFor();
    await row.getByRole("button", { name: "تعديل", exact: true }).click();
    assert.equal(await page.locator("#edit-maximum").inputValue(), "5000");
    assert.equal(await page.locator("#edit-customer-limit").inputValue(), "2");
    conflict = true;
    await page.locator("#edit-description").fill("Concurrent edit");
    await page.locator("#offer-save").click();
    await page
      .locator("#offer-save-status")
      .filter({ hasText: "تغيّرت" })
      .waitFor();
    assert.equal(
      await page.locator("#edit-description").inputValue(),
      "Concurrent edit",
    );
    conflict = false;
    await page.locator("#offer-cancel").click();
    await page.locator("#offer-create").click();
    await page.locator("#edit-source").selectOption("merchant");
    assert((await page.locator('#offer-funding-summary').textContent()).includes('المتجر'));
    await page.locator("#edit-title").fill("Tea savings");
    await page.locator("#edit-type").selectOption("fixed");
    await page.locator("#edit-value").fill("500");
    await page.locator("#merchant-choices input").first().check();
    await page.locator("#edit-applicability").selectOption("specificItems");
    await page
      .locator("#product-choices")
      .getByText("Tea", { exact: true })
      .waitFor();
    await page.locator("#product-choices input").first().check();
    await page.locator("#edit-slideshow").check();
    await page.screenshot({
      path: artifacts + "/editor-desktop.png",
      fullPage: true,
    });
    await page.locator("#offer-save").click();
    await page.waitForFunction(
      () => document.getElementById("slide-dialog").open,
    );
    assert.equal(
      await page.locator("#slide-title").inputValue(),
      "Tea savings",
    );
    assert.equal(await page.locator("#slide-action").inputValue(), "discount");
    const merchant = tables.WhizzMerchants_Discounts[0];
    assert.equal(merchant.businessId, "m1");
    assert.equal(merchant.type, "fixedAmount");
    assert.deepEqual(merchant.applicable_item_ids, ["p1"]);
    await page
      .locator("#slide-image")
      .setInputFiles({
        name: "banner.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await page
      .locator("#slide-upload-message")
      .filter({ hasText: "الصورة جاهزة" })
      .waitFor();
    await page.locator("#slide-save").click();
    await page.waitForFunction(
      () => !document.getElementById("slide-dialog").open,
    );
    assert.equal(current.slides.length, 1);
    assert.equal(current.slides[0].action.id, merchant.discountId);
    assert.equal(current.slides[0].status, "draft");
    // Report failure must not hide the slideshow or prevent editing.
    reportFailure = true;
    await page.locator("#slides-refresh").click();
    await page
      .locator(".slide-metrics")
      .filter({ hasText: "غير متاح" })
      .waitFor();
    await page.getByRole("button", { name: "تعديل الشريحة", exact: true }).click();
    await page.locator("#slide-cancel").click();
    await page.locator("#report-refresh").click();
    await page
      .locator("#report-status")
      .filter({ hasText: "غير متاح" })
      .waitFor();
    reportFailure = false;
    await page.locator("#offer-source-filter").selectOption("merchant");
    assert.equal(await page.locator(".offer-row").count(), 1);
    await page.locator("#offer-search").fill("no-match");
    await page.getByText("لا توجد عروض مطابقة", { exact: true }).waitFor();
    await page.locator("#offer-search").fill("");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: artifacts + "/overview-mobile.png",
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "mobile overview overflow",
    );
    await page.locator("#offer-create").click();
    await page.screenshot({
      path: artifacts + "/editor-mobile.png",
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () => document.getElementById("offer-dialog").scrollWidth <= innerWidth,
      ),
      "mobile editor overflow",
    );
    await page.evaluate(() => {
      document.documentElement.dir = "rtl";
      document.getElementById("edit-title").value = "عرض جديد";
    });
    await page.screenshot({ path: artifacts + "/editor-rtl.png", fullPage: true });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "RTL overflow",
    );
    await page.locator("#offer-cancel").click();
    actor = { ...actor, roles: ["platform_manager"] };
    await page.reload();
    await page.locator("#offers-load-status").waitFor({ state: "hidden" });
    assert(await page.locator("#offer-create").isDisabled());
    assert.equal(
      await page
        .locator(".offer-row")
        .getByRole("button", { name: "تعديل", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(".offer-row")
        .getByRole("button", { name: "تفعيل", exact: true })
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        optionalCode: true,
        baghdadTimeIndependentOfBrowser: true,
        createEditPauseActivate: true,
        itemTargeting: true,
        slideshowHandoff: true,
        imageUpload: true,
        preservesInputOnFailure: true,
        concurrentEdits: true,
        reportFailureIsolated: true,
        readOnlyControls: true,
        mobileAndRtl: true,
        realWrites: false,
        screenshots: artifacts,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
