(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    format = (n) =>
      Number(n || 0).toLocaleString("en-IQ", { maximumFractionDigits: 3 }),
    money = (n) => format(n) + " د.ع";
  const SOURCE = {
    campaign: "حملة المنصة",
    platform: "خصم المنصة",
    merchant: "خصم المتجر",
  };
  const AUDIENCE = {
    all: "جميع العملاء",
    registered: "العملاء المسجّلون",
    guests: "الزوار",
    new: "مسجّلون خلال آخر ٧ أيام",
    returning: "عملاء لديهم طلبات سابقة",
    inactive: "غير نشط منذ ٣٠ يومًا فأكثر",
    vip: "عملاء مميزون موثّقون",
  };
  const STATUS = {
    live: "سارٍ",
    scheduled: "مجدولة",
    draft: "مسودة",
    paused: "متوقف مؤقتًا",
    expired: "منتهية الصلاحية",
    exhausted: "مستنفد",
    attention: "يتطلب المراجعة",
  };
  let campaignImageKey = "", campaignImageUrl = "", imageUploading = false, imageGeneration = 0;
  let state = { offers: [], merchants: [], regions: [], permissions: {} },
    loaded = false,
    editing = null,
    busy = false,
    dirty = false,
    requestId = "",
    selectedMerchants = new Set(),
    selectedRegions = new Set(),
    selectedProducts = new Set(),
    catalog = { categories: [], products: [] },
    catalogMerchant = "",
    catalogGeneration = 0,
    slides = [],
    report = null,
    loadGeneration = 0;
  const node = (tag, value, cls) => {
    const n = document.createElement(tag);
    if (value != null) n.textContent = value;
    if (cls) n.className = cls;
    return n;
  };
  const button = (label, fn, cls = "btn-secondary") => {
    const b = node("button", label, cls);
    b.type = "button";
    b.onclick = fn;
    return b;
  };
  function notice(message, error = false) {
    $("workspace-notice").hidden = !message;
    $("workspace-notice").textContent = message;
    $("workspace-notice").className =
      "workspace-notice" + (error ? " error" : "");
  }
  async function api(path, body) {
    await window.Auth.ensureSession();
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 30000);
    try {
      const r = await fetch(
        window.WIZZCENTRAL_CONFIG.STAFF_API_BASE_URL + "/staff/" + path,
        {
          method: body ? "POST" : "GET",
          signal: controller.signal,
          headers: {
            Authorization: "Bearer " + window.Auth.getToken("accessToken"),
            "Content-Type": "application/json",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "Unable to complete this request.");
      return data;
    } catch (e) {
      if (e.name === "AbortError")
        throw Error(
          "The request timed out. Refresh to check whether it saved before trying again.",
        );
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  // Baghdad stays UTC+3; never interpret a date-only legacy field through the browser timezone.
  const instant = (v) =>
    v && /^\d{4}-\d\d-\d\d$/.test(v)
      ? v + "T00:00:00+03:00"
      : v && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(v)
        ? v + "+03:00"
        : v;
  const dateInput = (v) => {
    const t = Date.parse(instant(v));
    return Number.isFinite(t)
      ? new Date(t + 3 * 3600000).toISOString().slice(0, 16)
      : "";
  };
  const dateISO = (v) => new Date(v + ":00+03:00").toISOString();
  const dateLabel = (v) => {
    const t = Date.parse(instant(v));
    return Number.isFinite(t)
      ? new Intl.DateTimeFormat("ar-IQ", {
          timeZone: "Asia/Baghdad",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(t)
      : "دون تاريخ";
  };
  function effective(o) {
    if (o.unsupported) return "attention";
    if (o.status === "draft") return "draft";
    if (["paused", "inactive"].includes(o.status)) return "paused";
    if (o.status !== "active") return "attention";
    const start = Date.parse(instant(o.startAt)),
      end = Date.parse(instant(o.endAt));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return "attention";
    if (end <= Date.now()) return "expired";
    if (o.usageLimit > 0 && o.usage >= o.usageLimit) return "exhausted";
    if (start > Date.now()) return "scheduled";
    if (
      o.merchantIds.some(
        (id) => !state.merchants.some((m) => m.id === id && m.available),
      )
    )
      return "attention";
    return "live";
  }
  function benefit(o) {
    return o.type === "freeDelivery"
      ? "توصيل مجاني"
      : o.type === "percentage"
        ? format(o.value) + "٪ خصم"
        : money(o.value) + " خصم";
  }
  function merchantLabel(o) {
    return o.merchantIds.length
      ? o.merchantIds
          .map(
            (id) =>
              state.merchants.find((m) => m.id === id)?.label ||
              "متجر غير متاح",
          )
          .join(", ")
      : "جميع المتاجر";
  }
  function regionLabel(o) {
    return o.regionIds.length
      ? o.regionIds
          .map(
            (id) =>
              state.regions.find((r) => r.id === id)?.label ||
              "منطقة غير متاحة",
          )
          .join(", ")
      : "جميع المناطق";
  }
  function matchingSlides(o) {
    return slides.filter(
      (s) =>
        s.action.id === o.id &&
        s.action.type === (o.source === "merchant" ? "discount" : o.source),
    );
  }
  function addTerm(parent, value) {
    parent.append(node("p", value));
  }
  function terms(o) {
    return [
      o.minimumOrder > 0
        ? "الحد الأدنى للطلب: " + money(o.minimumOrder)
        : "دون حد أدنى للطلب",
      ...(o.maximumSavings != null
        ? ["وفّر حتى " + money(o.maximumSavings)]
        : []),
      merchantLabel(o),
      o.applicability === "specificItems"
        ? o.itemIds.length + " منتج مشمول"
        : o.applicability === "specificCategories"
          ? o.categoryIds.length + " فئة مشمولة"
          : "جميع المنتجات المشمولة",
      ...(o.audience || ["all"]).map((v) => AUDIENCE[v] || v),
      ...(o.firstOrderOnly ? ["للطلب الأول فقط"] : []),
      ...(o.campaignType === "new-customer"
        ? ["مسجّلون خلال آخر ٧ أيام"]
        : []),
      ...(o.singleUse
        ? ["استخدام واحد لكل عميل"]
        : o.perCustomerLimit
          ? ["حتى " + o.perCustomerLimit + " استخدام لكل عميل"]
          : []),
      regionLabel(o),
      "ينتهي في " + dateLabel(o.endAt) + " · بغداد",
      o.code ? "الرمز: " + o.code : "لا يلزم إدخال رمز عند فتح العرض من الشريحة",
    ];
  }
  function render() {
    const q = $("offer-search").value.trim().toLocaleLowerCase(),
      source = $("offer-source-filter").value,
      status = $("offer-status-filter").value;
    const offers = state.offers.filter(
      (o) =>
        (source === "all" ||
          (source === "platform"
            ? o.source !== "merchant"
            : o.source === "merchant")) &&
        (status === "all" || effective(o) === status) &&
        (!q ||
          [o.title, o.code, merchantLabel(o)]
            .join(" ")
            .toLocaleLowerCase()
            .includes(q)),
    );
    $("offers-list").replaceChildren();
    $("offers-count").textContent =
      offers.length + " / " + state.offers.length + " عروض";
    for (const o of offers) {
      const row = node("article", null, "offer-row"),
        identity = node("div"),
        identityLabel = node("span", SOURCE[o.source], "source-label");
      identity.append(identityLabel, node("h3", o.title));
      const code = node("p");
      if (o.code) code.append(node("span", o.code, "offer-code"));
      code.append(
        node(
          "span",
          matchingSlides(o).length
            ? "مرتبط بـ " + matchingSlides(o).length + " شريحة رئيسية"
            : "غير مرتبط بشريحة",
        ),
      );
      identity.append(code);
      identity.append(node('small', window.CampaignFundingDisclosure.describe(o).summary, 'offer-funding-summary'));
      const value = node("div");
      value.append(
        node("div", benefit(o), "offer-value"),
        node(
          "small",
          o.minimumOrder ? "الحد الأدنى: " + money(o.minimumOrder) : "دون حد أدنى للطلب",
        ),
        node(
          "small",
          o.maximumSavings != null
            ? "حتى " + money(o.maximumSavings)
            : "دون حد أعلى للتوفير",
        ),
      );
      const target = node("div", null, "offer-eligibility");
      target.append(
        node("p", merchantLabel(o)),
        node(
          "small",
          (o.audience || ["all"]).map((v) => AUDIENCE[v] || v).join(", "),
        ),
        node(
          "small",
          o.firstOrderOnly
            ? "للطلب الأول فقط"
            : o.applicability === "specificItems"
              ? "منتجات محددة"
              : o.applicability === "specificCategories"
                ? "فئات محددة"
                : regionLabel(o),
        ),
      );
      const timing = node("div", null, "offer-timing");
      const s = effective(o);
      timing.append(
        node("span", STATUS[s], "status-pill " + s),
        node(
          "p",
          format(o.usage) +
            " / " +
            (o.usageLimit ? format(o.usageLimit) : "∞") +
            " استخدام",
        ),
        node(
          "small",
          s === "scheduled"
            ? "يبدأ في " + dateLabel(o.startAt)
            : "ينتهي في " + dateLabel(o.endAt),
        ),
      );
      const actions = node("div", null, "row-actions");
      actions.append(button("التفاصيل", () => details(o)));
      if(o.sharingLocked)actions.append(node("span","خصم مشترك — الشروط مقفلة"));
      if (state.permissions.edit && !o.unsupported && !o.sharingLocked) {
        const edit = button("تعديل", () => open(o));
        edit.disabled = o.status === "active" && !state.permissions.approve;
        edit.title = edit.disabled
          ? "يتطلب تعديل عرض سارٍ صلاحية الاعتماد."
          : "";
        actions.append(edit);
      }
      if (state.permissions.approve && !o.unsupported) {
        const toggle = button(
          o.status === "active" ? "إيقاف مؤقت" : "تفعيل",
          () => toggleStatus(o),
        );
        toggle.disabled = busy || (o.sharingLocked && !o.sharingCanActivate && o.status !== 'active');
        actions.append(toggle);
      }
      row.append(identity, value, target, timing, actions);
      $("offers-list").append(row);
    }
    if (!offers.length) {
      const empty = node("div", null, "empty-state");
      empty.append(
        node(
          "h3",
          state.offers.length
            ? "لا توجد عروض مطابقة"
            : "ابدأ إعداد حملتك التالية",
        ),
        node(
          "p",
          state.offers.length
            ? "جرّب عبارة بحث أو معايير تصفية أخرى."
            : "أنشئ عرضًا وحدّد جمهوره، ثم أضفه إلى شرائح الشاشة الرئيسية.",
        ),
      );
      $("offers-list").append(empty);
    }
    for (const s of ["live", "scheduled", "draft"])
      $("metric-" + s).textContent = state.offers.filter(
        (o) => effective(o) === s,
      ).length;
    $("offer-create").disabled = !state.permissions.create;
    $("offers-load-status").hidden = true;
    document.dispatchEvent(new Event("offers:loaded"));
  }
  async function loadOffers() {
    const generation = ++loadGeneration;
    $("offers-refresh").disabled = true;
    $("offers-load-status").hidden = false;
    $("offers-load-status").textContent = "جارٍ تحميل العروض…";
    try {
      const result = await api("offers");
      if (generation !== loadGeneration) return;
      const lookup = new Map(result.regions.map((r) => [r.id, r]));
      result.regions = result.regions.map((r) => {
        const labels = [r.label],
          seen = new Set([r.id]);
        let p = lookup.get(r.parentId);
        while (p && !seen.has(p.id)) {
          seen.add(p.id);
          labels.unshift(p.label);
          p = lookup.get(p.parentId);
        }
        return { ...r, label: labels.join(" › ") };
      });
      state = result;
      loaded = true;
      render();
      return true;
    } catch (e) {
      if (generation === loadGeneration) {
        $("offers-load-status").hidden = false;
        $("offers-load-status").replaceChildren(
          node("p", "تعذّر تحميل العروض: " + window.WizzLocale.error(e.message)),
          button("إعادة المحاولة", loadOffers),
        );
      }
      return false;
    } finally {
      if (generation === loadGeneration) $("offers-refresh").disabled = false;
    }
  }
  async function loadReport() {
    try {
      $("report-refresh").disabled = true;
      report = await api("slideshow/report");
      for (const key of ["views", "taps", "orders", "savings"])
        $("report-" + key).textContent = format(
          report.slides.reduce(
            (sum, s) =>
              sum + Number(s[key === "savings" ? "savingsFils" : key] || 0),
            0,
          ) / (key === "savings" ? 1000 : 1),
        );
      $("report-status").textContent =
        report.note +
        " تُحتسب الجلسة مرة واحدة كحد أقصى لكل شريحة ونوع حدث ويوم بالتوقيت العالمي UTC.";
    } catch (e) {
      for (const key of ["views", "taps", "orders", "savings"])
        $("report-" + key).textContent = "—";
      $("report-status").textContent = "التقرير غير متاح: " + window.WizzLocale.error(e.message);
    } finally {
      $("report-refresh").disabled = false;
    }
  }
  function renderChoices(container, rows, selected, search, change) {
    container.replaceChildren();
    for (const row of rows.filter(
      (r) =>
        selected.has(r.id) ||
        r.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    )) {
      const label = node("label"),
        check = document.createElement("input");
      check.type = "checkbox";
      check.checked = selected.has(row.id);
      check.onchange = () => {
        check.checked ? selected.add(row.id) : selected.delete(row.id);
        change(row.id, check.checked);
      };
      const name = node("span", row.label);
      if (row.available === false)
        name.append(node("small", "غير متاح حاليًا"));
      label.append(check, name);
      container.append(label);
    }
    if (!container.children.length) container.append(node("p", "لا توجد نتائج مطابقة."));
  }
  function renderMerchants() {
    renderChoices(
      $("merchant-choices"),
      state.merchants,
      selectedMerchants,
      $("merchant-search").value,
      (id, checked) => {
        if ($("edit-source").value === "merchant" && checked)
          selectedMerchants = new Set([id]);
        renderMerchants();
        refreshCatalog();
        update();
      },
    );
    $("merchant-summary").textContent =
      selectedMerchants.size + " متجر محدد";
  }
  function renderRegions() {
    const all = $("edit-all-regions").checked;
    $("region-search").disabled = all;
    $("region-choices").hidden = all;
    if (!all)
      renderChoices(
        $("region-choices"),
        state.regions,
        selectedRegions,
        $("region-search").value,
        () => {
          renderRegions();
          update();
        },
      );
    $("region-summary").textContent = all
      ? "يشمل جميع المناطق."
      : selectedRegions.size +
        " منطقة محددة. يشمل اختيار المنطقة الأم جميع المناطق التابعة لها.";
  }
  async function refreshCatalog(preserve = false) {
    const generation = ++catalogGeneration,
      merchantId =
        selectedMerchants.size === 1 ? [...selectedMerchants][0] : "";
    if (!preserve) selectedProducts.clear();
    catalog = { categories: [], products: [] };
    catalogMerchant = "";
    $("catalog-retry").hidden = true;
    if ($("edit-applicability").value === "allItems") {
      renderProducts();
      return;
    }
    if (!merchantId || $("edit-merchant-mode").value === "all") {
      $("catalog-status").textContent =
        "اختر متجرًا واحدًا لتحديد المنتجات أو الفئات.";
      renderProducts();
      return;
    }
    $("catalog-status").textContent = "جارٍ تحميل المنتجات والفئات…";
    renderProducts();
    try {
      const result = await api(
        "offers/catalog?merchantId=" + encodeURIComponent(merchantId),
      );
      if (generation !== catalogGeneration) return;
      catalog = result;
      catalogMerchant = merchantId;
      $("catalog-status").textContent =
        "اختر من منتجات المتجر وفئاته المسجّلة.";
      renderProducts();
    } catch (e) {
      if (generation !== catalogGeneration) return;
      $("catalog-status").textContent =
        "تعذّر تحميل المنتجات والفئات: " + window.WizzLocale.error(e.message);
      $("catalog-retry").hidden = false;
    }
  }
  function renderProducts() {
    const type = $("edit-applicability").value;
    $("product-picker").hidden = type === "allItems";
    const rows =
      type === "specificItems" ? catalog.products : catalog.categories;
    renderChoices(
      $("product-choices"),
      rows,
      selectedProducts,
      $("product-search").value,
      () => {
        renderProducts();
        update();
      },
    );
    $("product-summary").textContent =
      selectedProducts.size +
      " محدد. لا تظهر المنتجات غير المتاحة للعملاء.";
  }
  function collect() {
    const applicability = $("edit-applicability").value;
    return {
      id: editing?.id || requestId,
      source: $("edit-source").value,
      baseRevision: editing?.revision ?? null,
      title: $("edit-title").value.trim(),
      imageKey: campaignImageKey,
      description: $("edit-description").value.trim(),
      code: $("edit-code").value.trim().toUpperCase(),
      type: $("edit-type").value,
      value:
        $("edit-type").value === "freeDelivery"
          ? 0
          : Number($("edit-value").value),
      minimumOrder: Number($("edit-minimum").value),
      maximumSavings: $("edit-maximum").value
        ? Number($("edit-maximum").value)
        : null,
      startAt: $("edit-start").value ? dateISO($("edit-start").value) : "",
      endAt: $("edit-end").value ? dateISO($("edit-end").value) : "",
      status: $("edit-status").value,
      audience: [$("edit-audience").value],
      merchantIds:
        $("edit-merchant-mode").value === "all" ? [] : [...selectedMerchants],
      regionIds: $("edit-all-regions").checked ? [] : [...selectedRegions],
      firstOrderOnly:
        $("edit-first-order").checked ||
        $("edit-purpose").value === "first-order",
      campaignType: $("edit-purpose").value,
      singleUse: $("edit-single-use").checked,
      perCustomerLimit: $("edit-single-use").checked
        ? 1
        : $("edit-customer-limit").value
          ? Number($("edit-customer-limit").value)
          : null,
      usageLimit: Number($("edit-limit").value),
      applicability,
      itemIds: applicability === "specificItems" ? [...selectedProducts] : [],
      categoryIds:
        applicability === "specificCategories" ? [...selectedProducts] : [],
    };
  }
  function checks(o) {
    const warnings = [];
    if (!o.title) warnings.push("Add a title customers will recognize.");
    if (o.type !== "freeDelivery" && o.value <= 0)
      warnings.push("Set a discount greater than zero.");
    if (o.type === "percentage" && o.value > 100)
      warnings.push("Percentage cannot exceed 100.");
    if (!o.startAt || !o.endAt || Date.parse(o.endAt) <= Date.parse(o.startAt))
      warnings.push("Choose an end time after the start time.");
    if (o.endAt && Date.parse(o.endAt) <= Date.now())
      warnings.push("This offer has ended and will stay hidden.");
    if (o.source === "merchant" && o.merchantIds.length !== 1)
      warnings.push("Choose exactly one merchant.");
    if ($("edit-merchant-mode").value === "selected" && !o.merchantIds.length)
      warnings.push("Select at least one merchant.");
    if (!$("edit-all-regions").checked && !o.regionIds.length)
      warnings.push("Select at least one region.");
    if (
      o.applicability !== "allItems" &&
      (o.merchantIds.length !== 1 ||
        catalogMerchant !== o.merchantIds[0] ||
        !selectedProducts.size)
    )
      warnings.push(
        "Load the merchant catalogue and choose eligible products.",
      );
    if (
      o.audience[0] === "guests" &&
      (o.firstOrderOnly || o.singleUse || o.perCustomerLimit)
    )
      warnings.push(
        "Customer history restrictions require a signed-in customer.",
      );
    return warnings;
  }
  function update() {
    const source = $("edit-source").value,
      free = $("edit-type").value === "freeDelivery";
    $("edit-value").disabled = free;
    $("edit-value").required = !free;
    $("value-field").hidden = free;
    $("edit-value").max =
      $("edit-type").value === "percentage" ? "100" : "1000000000";
    $("edit-customer-limit").disabled = $("edit-single-use").checked;
    $("edit-purpose").disabled = source === "merchant";
    if (source === "merchant") $("edit-merchant-mode").value = "selected";
    $("edit-merchant-mode").disabled = source === "merchant";
    $("merchant-picker").hidden = $("edit-merchant-mode").value === "all";
    $("edit-all-regions").disabled = !state.permissions.allRegions;
    $("edit-status").querySelector("[value=active]").disabled =
      !state.permissions.approve;
    $("permission-note").textContent = state.permissions.approve
      ? "تسري العروض المفعّلة وفق جدولها الزمني."
      : "يمكنك حفظ المسودات. يتطلب النشر صلاحية الاعتماد.";
    let o;
    try {
      o = collect();
    } catch {
      return;
    }
    $("preview-benefit").textContent =
      o.value || free ? benefit(o) : "عرضك المميز التالي";
    $("preview-title").textContent = o.title || "عنوان العرض";
    $("preview-description").textContent = o.description;
    $("preview-source").textContent = SOURCE[o.source];
    const funding = window.CampaignFundingDisclosure.describe(o, !!editing);
    $('offer-funding-summary').textContent = funding.summary;
    $('offer-funding-change').textContent = funding.changeNotice;
    $("preview-terms").replaceChildren();
    for (const term of terms(o)) addTerm($("preview-terms"), term);
    $("offer-checks").replaceChildren();
    for (const warning of checks(o))
      $("offer-checks").append(node("p", warning, "check-warning"));
    if (o.startAt && Date.parse(o.startAt) > Date.now())
      $("offer-checks").append(
        node("p", "مجدول في " + dateLabel(o.startAt) + " بغداد."),
      );
    if (
      o.audience[0] === "all" &&
      (o.firstOrderOnly || o.singleUse || o.perCustomerLimit)
    )
      $("offer-checks").append(
        node(
          "p",
          "تقيّد شروط سجل العميل المحددة خيار «جميع العملاء». لا يمكن للزوار استخدام هذا العرض.",
        ),
      );
    if (!o.code)
      $("offer-checks").append(
        node(
          "p",
          "إذا كان العرض دون رمز، فاربطه بشريحة رئيسية ليتمكن العملاء من اختياره.",
        ),
      );
    $("offer-save").textContent = $("edit-slideshow").checked
      ? "حفظ العرض وإعداد الشريحة"
      : "حفظ العرض";
  }
  function open(o) {
    if (!loaded) return;
    editing = o || null;
    imageGeneration++;
    campaignImageKey = o?.imageKey || "";
    campaignImageUrl = o?.imageUrl || "";
    $("offer-image-preview").hidden = !campaignImageUrl;
    $("offer-image-preview").src = campaignImageUrl;
    $("offer-image-status").textContent = "";
    requestId = o?.id || "offer_" + crypto.randomUUID().replaceAll("-", "");
    dirty = false;
    catalogGeneration++;
    $("offer-form").reset();
    selectedMerchants = new Set(o?.merchantIds || []);
    selectedRegions = new Set(o?.regionIds || []);
    selectedProducts = new Set(
      o?.applicability === "specificItems" ? o.itemIds : o?.categoryIds || [],
    );
    catalog = { categories: [], products: [] };
    catalogMerchant = "";
    const values = {
      source: o?.source || "campaign",
      title: o?.title || "",
      code: o?.code || "",
      description: o?.description || "",
      purpose: o?.campaignType || "promotional",
      type: o?.type || "percentage",
      value: o?.value ?? "",
      minimum: o?.minimumOrder ?? 0,
      maximum: o?.maximumSavings ?? "",
      audience: o?.audience?.[0] || "all",
      "customer-limit": o?.perCustomerLimit ?? "",
      status:
        o?.status === "active"
          ? "active"
          : o?.status === "paused" || o?.status === "inactive"
            ? "paused"
            : "draft",
      limit: o?.usageLimit ?? 0,
      applicability: o?.applicability || "allItems",
      start: dateInput(o?.startAt || new Date().toISOString()),
      end: dateInput(
        o?.endAt || new Date(Date.now() + 7 * 86400000).toISOString(),
      ),
    };
    for (const [key, value] of Object.entries(values))
      $("edit-" + key).value = value;
    if (!$("edit-purpose").value) $("edit-purpose").value = "promotional";
    $("edit-source").disabled = !!o;
    $("edit-first-order").checked = !!o?.firstOrderOnly;
    $("edit-single-use").checked = !!o?.singleUse;
    $("edit-merchant-mode").value = o?.merchantIds.length ? "selected" : "all";
    $("edit-all-regions").checked = o
      ? !o.regionIds.length
      : !!state.permissions.allRegions;
    if (!state.permissions.allRegions && !selectedRegions.size)
      selectedRegions = new Set(state.regions.map((r) => r.id));
    $("offer-editor-title").textContent = o ? "تعديل العرض" : "إنشاء عرض";
    $("offer-save-status").textContent = "";
    $("merchant-search").value = "";
    $("region-search").value = "";
    $("product-search").value = "";
    renderMerchants();
    renderRegions();
    update();
    refreshCatalog(true);
    $("offer-dialog").showModal();
    document.querySelector(".editor-body").scrollTop = 0;
    $("edit-title").focus();
  }
  function close() {
    if (busy) return;
    if (dirty && !window.confirm("هل تريد تجاهل التغييرات غير المحفوظة على العرض؟")) return;
    $("offer-dialog").close();
  }
  async function save(e) {
    e.preventDefault();
    if (busy || imageUploading) return;
    const data = collect(),
      warnings = checks(data).filter((w) => !w.includes("has ended"));
    if (warnings.length) {
      $("offer-save-status").textContent = warnings.join("\n");
      $("offer-save-status").focus();
      return;
    }
    busy = true;
    $("offer-save").disabled = true;
    $("offer-cancel").disabled = true;
    $("offer-save-status").textContent = "جارٍ حفظ العرض…";
    try {
      await api("offers/save", data);
      dirty = false;
      editing = { ...data, revision: null };
      $("offer-dialog").close();
      notice(
        "Offer saved. " +
          (data.status === "active"
            ? "تظهر الحملة بصورتها في نافذة مستقلة للمستخدمين المؤهلين خلال فترة السريان. افتح التفاصيل لإرسال الإشعار."
            : "It is " + data.status + " and hidden from customers."),
      );
      const ok = await loadOffers();
      await window.HomeSlideshow?.reload();
      if ($("edit-slideshow").checked) {
        if (ok)
          await setupSlide(
            state.offers.find(
              (o) => o.id === data.id && o.source === data.source,
            ) || data,
          );
        else
          notice(
            "Offer saved. Refresh the library, then select Home slide to finish placement.",
            true,
          );
      }
    } catch (err) {
      $("offer-save-status").textContent = window.WizzLocale.error(err.message);
      $("offer-save-status").focus();
    } finally {
      busy = false;
      $("offer-save").disabled = false;
      $("offer-cancel").disabled = false;
      if (loaded) render();
    }
  }
  async function setupSlide(o) {
    if (!window.HomeSlideshow) {
      notice("Slideshow is still loading. Please try again.", true);
      return;
    }
    try {
      await window.HomeSlideshow.forOffer(o);
    } catch (e) {
      notice(
        "Offer is saved. Could not open slideshow setup: " + window.WizzLocale.error(e.message),
        true,
      );
    }
  }
  async function toggleStatus(o) {
    if (busy) return;
    const status = o.status === "active" ? "paused" : "active";
    if (status === "active" && Date.parse(instant(o.endAt)) <= Date.now()) {
      notice(
        "This offer has expired. Edit its schedule before activating it.",
        true,
      );
      return;
    }
    busy = true;
    render();
    try {
      await api("offers/status", {
        id: o.id,
        source: o.source,
        baseRevision: o.revision,
        status,
      });
      notice(
        "Offer " +
          (status === "active"
            ? "activated. It follows its schedule."
            : "paused. Linked offer slides will be hidden."),
      );
      await loadOffers();
      await window.HomeSlideshow?.reload();
    } catch (e) {
      notice(window.WizzLocale.error(e.message), true);
    } finally {
      busy = false;
      render();
    }
  }
  const pushStates = {
    NOT_REQUESTED: 'لم يُطلب إرسال إشعار لهذه النسخة من الحملة.',
    QUEUED: 'الإشعار في قائمة الإرسال. حدّث الحالة بعد قليل.',
    PROCESSING: 'جارٍ إرسال الإشعار.',
    SENDING: 'جارٍ إرسال الإشعار.',
    SENT: 'اكتمل إرسال الإشعار.',
    NO_RECIPIENTS: 'لا توجد أجهزة مؤهلة لاستلام إشعار هذه الحملة.',
    PARTIAL: 'وصل الإشعار إلى بعض الأجهزة وتعذر إرساله إلى أجهزة أخرى.',
    FAILED: 'تعذر إرسال الإشعار. راجع نتيجة الإرسال قبل إعادة المحاولة.',
  };
  function notificationControls(o) {
    const section = node('section', null, 'detail-notifications');
    const status = node('p', 'جارٍ التحقق من حالة الإشعار…');
    status.setAttribute('role', 'status');
    const send = button('إرسال إشعار الحملة', async () => {
      send.disabled = refresh.disabled = true;
      status.textContent = 'جارٍ طلب إرسال الإشعار…';
      try {
        // This API supplies its own revision; the offer editor revision uses a different contract.
        const latest = await api('promotions?source=PLATFORM&discountId=' + encodeURIComponent(o.id));
        show(await api('promotions', {
          source: 'PLATFORM', discountId: o.id, action: 'NOTIFY',
          baseRevision: latest.revision,
        }));
      } catch (e) {
        status.textContent = 'تعذر طلب الإشعار: ' + window.WizzLocale.error(e.message);
        send.disabled = !canSend;
      } finally { refresh.disabled = false; }
    }, 'btn-primary');
    const canSend = state.permissions.edit && state.permissions.approve && effective(o) === 'live';
    function show(result) {
      const counts = result.counts;
      status.textContent = (pushStates[result.notificationStatus] || result.notificationStatus) +
        (counts ? ' المستهدف: ' + format(counts.targeted) + '، المرسل: ' + format(counts.sent) + '، المتعذر: ' + format(counts.failed) + '.' : '');
      send.disabled = !canSend || !(result.notificationStatus === 'NOT_REQUESTED' || result.retryable === true);
      send.textContent = result.retryable ? 'إعادة محاولة إرسال الإشعار' : 'إرسال إشعار الحملة';
    }
    const refresh = button('تحديث حالة الإشعار', async () => {
      refresh.disabled = true;
      try { show(await api('promotions', {source: 'PLATFORM', discountId: o.id, action: 'NOTIFY_STATUS'})); }
      catch (e) { status.textContent = 'تعذر التحقق من الإشعار: ' + window.WizzLocale.error(e.message); send.disabled = true; }
      finally { refresh.disabled = false; }
    });
    send.disabled = true;
    section.append(node('h4', 'إشعار تطبيق المستخدم'), status,
      node('p', 'حفظ الحملة لا يرسل إشعاراً. الإرسال يستهدف الأجهزة المؤهلة وفق شروط الحملة، ويتطلب صلاحية التعديل والاعتماد.'), send, refresh);
    refresh.click();
    return section;
  }
  async function details(o) {
    $("offer-detail-title").textContent = o.title;
    const content = $("offer-detail-content");
    content.replaceChildren(
      node("span", STATUS[effective(o)], "status-pill " + effective(o)),
      node("h3", benefit(o)),
    );
    if (o.unsupported)
      content.append(
        node(
          "p",
          "يتضمن هذا العرض السابق شروطًا لا يدعم المحرر تعديلها حاليًا. سيُحتفظ بشروطه الحالية.",
          "detail-warning",
        ),
      );
    if (o.description) content.append(node("p", o.description));
    const funding = window.CampaignFundingDisclosure.describe(o, true);
    content.append(node('h3', 'مسؤولية التمويل'), node('p', funding.summary), node('p', funding.changeNotice, 'detail-warning'));
    const dl = node("dl");
    for (const [label, value] of [
      ["Source", SOURCE[o.source]],
      ["Code", o.code || "Not required through a slideshow"],
      ["Eligibility", terms(o).join(" · ")],
      ["Starts", dateLabel(o.startAt) + " Baghdad"],
      [
        "Usage",
        format(o.usage) +
          " / " +
          (o.usageLimit ? format(o.usageLimit) : "Unlimited"),
      ],
      ["Home slideshow", matchingSlides(o).length + " linked slide(s)"],
    ])
      dl.append(node("dt", label), node("dd", value));
    content.append(dl);
    const actions = node("div", null, "detail-actions");
    if (
      state.permissions.edit &&
      !o.sharingLocked &&
      !o.unsupported &&
      (o.status !== "active" || state.permissions.approve)
    )
      actions.append(
        button("تعديل العرض", () => {
          $("offer-detail-dialog").close();
          open(o);
        }),
      );
    if (window.HomeSlideshow?.canEdit())
      actions.append(
        button(
          matchingSlides(o).length ? "إدارة الشريحة الرئيسية" : "إضافة شريحة للرئيسية",
          () => {
            $("offer-detail-dialog").close();
            setupSlide(o);
          },
          "btn-primary",
        ),
      );
    content.append(actions);
    content.append(node('p', 'تظهر الحملة بصورتها وتفاصيلها في نافذة مستقلة للمستخدمين المؤهلين خلال فترة السريان. شرائح السلايد شو موضع اختياري منفصل.'));
    if (o.source !== 'merchant') content.append(notificationControls(o));
    $("offer-detail-dialog").showModal();
    if (o.applicability !== "allItems" && o.merchantIds.length === 1) {
      const section = node("div", null, "detail-catalog");
      section.append(
        node(
          "h4",
          "Eligible " +
            (o.applicability === "specificItems" ? "items" : "categories"),
        ),
        node("p", "جارٍ تحميل المنتجات والفئات…"),
      );
      content.append(section);
      try {
        const data = await api(
          "offers/catalog?merchantId=" + encodeURIComponent(o.merchantIds[0]),
        );
        const rows =
            o.applicability === "specificItems"
              ? data.products
              : data.categories,
          ids = o.applicability === "specificItems" ? o.itemIds : o.categoryIds;
        section.replaceChildren(
          node(
            "h4",
            "Eligible " +
              (o.applicability === "specificItems" ? "items" : "categories"),
          ),
        );
        for (const id of ids) {
          const row = rows.find((r) => r.id === id);
          section.append(
            node(
              "p",
              (row?.label || id) +
                (row?.available === false ? " · غير متاح حاليًا" : ""),
            ),
          );
        }
      } catch (e) {
        section.append(node("p", "المنتجات والفئات غير متاحة: " + window.WizzLocale.error(e.message)));
      }
    }
  }
  document.addEventListener("slideshow:loaded", (e) => {
    slides = e.detail.slides || [];
    $("metric-slides").textContent = slides.filter((s) => {
      const offer = state.offers.find((o) =>
        matchingSlides(o).some((x) => x.id === s.id),
      );
      return (
        s.status === "published" &&
        Date.parse(s.startAt) <= Date.now() &&
        Date.parse(s.endAt) > Date.now() &&
        (!offer || effective(offer) === "live")
      );
    }).length;
    if (loaded) render();
  });
  $("offer-create").onclick = () => open();
  $("offers-refresh").onclick = async () => {
    await loadOffers();
    await window.HomeSlideshow?.reload();
  };
  $("report-refresh").onclick = loadReport;
  for (const id of [
    "offer-search",
    "offer-source-filter",
    "offer-status-filter",
  ])
    $(id).addEventListener(id === "offer-search" ? "input" : "change", render);
  $("offer-close").onclick = close;
  $("offer-cancel").onclick = close;
  $("offer-dialog").addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  $("offer-detail-close").onclick = () => $("offer-detail-dialog").close();
  $("offer-image-remove").onclick = () => {
    imageGeneration++; campaignImageKey = ""; campaignImageUrl = ""; dirty = true;
    $("offer-image").value = ""; $("offer-image-preview").hidden = true;
  };
  $("offer-image").onchange = async () => {
    const file = $("offer-image").files[0]; if (!file) return;
    const generation = ++imageGeneration;
    imageUploading = true; $("offer-save").disabled = true; $("offer-image").disabled = true; $("offer-image-remove").disabled = true;
    $("offer-image-status").textContent = "جارٍ رفع الصورة…";
    const url = URL.createObjectURL(file);
    try {
      if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 10*1024*1024) throw Error("Choose a JPG, PNG or WebP image under 10 MB.");
      const img = new Image(); img.src = url; await img.decode();
      if (img.naturalWidth*img.naturalHeight > 40000000) throw Error("Choose an image under 40 megapixels.");
      const canvas = document.createElement("canvas"), ratio = Math.min(1,1600/img.naturalWidth,1600/img.naturalHeight);
      canvas.width = Math.max(1,Math.round(img.naturalWidth*ratio)); canvas.height = Math.max(1,Math.round(img.naturalHeight*ratio));
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height);
      let image; for (const quality of [.85,.7,.55,.4]) { image = canvas.toDataURL("image/jpeg",quality).split(",")[1]; if (image.length < 790000) break; }
      if (image.length >= 790000) throw Error("Image is too detailed. Choose a smaller image.");
      const result = await api("slideshow/upload",{image});
      if (generation !== imageGeneration) return;
      campaignImageKey = result.imageKey; campaignImageUrl = result.imageUrl; dirty = true;
      $("offer-image-preview").src = campaignImageUrl; $("offer-image-preview").hidden = false;
      $("offer-image-status").textContent = "الصورة جاهزة للحفظ مع الحملة.";
    } catch (e) { if (generation === imageGeneration) $("offer-image-status").textContent = window.WizzLocale.error(e.message); }
    finally { URL.revokeObjectURL(url); imageUploading = false; $("offer-save").disabled = busy; $("offer-image").disabled = false; $("offer-image-remove").disabled = false; }
  };
  $("offer-form").onsubmit = save;
  $("offer-form").addEventListener("input", () => {
    dirty = true;
    update();
  });
  $("offer-form").addEventListener("change", () => {
    dirty = true;
    update();
  });
  $("edit-code").addEventListener("input", () => {
    $("edit-code").value = $("edit-code").value.toUpperCase();
  });
  $("edit-source").addEventListener("change", () => {
    if ($("edit-source").value === "merchant" && selectedMerchants.size > 1)
      selectedMerchants = new Set();
    renderMerchants();
    refreshCatalog();
    update();
  });
  $("edit-purpose").addEventListener("change", () => {
    if ($("edit-purpose").value === "first-order")
      $("edit-first-order").checked = true;
    update();
  });
  $("edit-merchant-mode").addEventListener("change", () => {
    if ($("edit-merchant-mode").value === "all") selectedMerchants.clear();
    renderMerchants();
    refreshCatalog();
    update();
  });
  $("edit-applicability").addEventListener("change", () => refreshCatalog());
  $("merchant-search").oninput = renderMerchants;
  $("region-search").oninput = renderRegions;
  $("product-search").oninput = renderProducts;
  $("edit-all-regions").onchange = renderRegions;
  $("catalog-retry").onclick = () => refreshCatalog(true);
  window.addEventListener("beforeunload", (e) => {
    if (dirty && $("offer-dialog").open) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && loaded) render();
  });
  setInterval(() => {
    if (!document.hidden && loaded) render();
  }, 60000);
  window.PromotionsWorkspace = {
    effective,
    dateInput,
    dateISO,
    load: loadOffers,
    canMessage: () =>
      !!(state.permissions.allRegions && state.permissions.approve),
  };
  if (window.navigationManager) window.navigationManager.init().catch(() => {});
  loadOffers();
  loadReport();
})();
