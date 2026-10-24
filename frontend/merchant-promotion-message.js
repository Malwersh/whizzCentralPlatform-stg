// Preserve the existing, explicit merchant broadcast workflow; saving an offer never sends a message.
(function () {
  "use strict";
  const open = document.createElement("button");
  open.type = "button";
  open.id = "merchant-message-open";
  open.className = "btn-secondary";
  open.textContent = "إرسال إلى المتاجر";
  document.querySelector(".workspace-header .header-actions").prepend(open);
  open.disabled = true;
  document.addEventListener("offers:loaded", () => {
    open.disabled = !window.PromotionsWorkspace?.canMessage();
    open.title = open.disabled
      ? "يتطلب إرسال الرسائل إلى المتاجر صلاحية اعتماد العروض على مستوى المنصة."
      : "";
  });
  const dialog = document.createElement("dialog");
  dialog.id = "merchant-message-dialog";
  dialog.setAttribute("aria-labelledby", "merchant-message-heading");
  dialog.innerHTML =
    "<form id=\"merchant-message-form\"><header class=\"offer-editor-header\"><div><p class=\"eyebrow\">التواصل مع المتاجر</p><h2 id=\"merchant-message-heading\">إرسال إلى المتاجر</h2></div><button type=\"button\" class=\"icon-button\" aria-label=\"إغلاق رسالة المتاجر\">×</button></header><div class=\"detail-content\"><p class=\"inline-note\">يرسل هذا الإجراء إشعارًا إلى تطبيق المتاجر، ولا ينشر شريحة في تطبيق ويز يوزر.</p><div class=\"form-grid\"><label>نوع الرسالة<select name=\"notificationType\"><option value=\"info\">معلومات</option><option value=\"feature\">ميزة جديدة</option><option value=\"policy\">سياسة</option><option value=\"warning\">تحذير</option><option value=\"urgent\">عاجل</option></select></label><label>الجمهور<select name=\"targetAudience\"><option value=\"all\">جميع المتاجر</option><option value=\"active\">نشط خلال آخر ٣٠ يومًا</option><option value=\"inactive\">لا توجد طلبات حديثة</option><option value=\"new\">انضم خلال آخر ١٤ يومًا</option><option value=\"by_city\">بحسب المدينة</option><option value=\"by_category\">بحسب الفئة</option></select></label><label class=\"full-width\">العنوان<input name=\"notificationTitle\" required maxlength=\"100\" dir=\"auto\"></label><label class=\"full-width\">الرسالة<textarea name=\"notificationBody\" required maxlength=\"500\" rows=\"4\" dir=\"auto\"></textarea></label><label data-city hidden>المدينة<input name=\"city\" placeholder=\"مثال: النجف\"></label><label data-category hidden>فئة النشاط التجاري<select name=\"businessCategory\"><option value=\"\">اختر الفئة</option><option value=\"restaurant\">مطعم</option><option value=\"grocery\">بقالة</option><option value=\"pharmacy\">صيدلية</option><option value=\"retail\">تجارة التجزئة</option></select></label><label>الأولوية<select name=\"priority\"><option value=\"normal\">اعتيادية</option><option value=\"high\">عالية</option></select></label><label>موعد الإرسال<select name=\"sendTime\"><option value=\"now\">الآن</option><option value=\"scheduled\">الجدول الزمني</option></select></label><label data-schedule hidden>موعد الإرسال بتوقيت بغداد<input name=\"scheduledTime\" type=\"datetime-local\"></label><label>رابط الانتقال <small>اختياري</small><input name=\"actionUrl\" type=\"url\"></label><label>رابط الصورة <small>اختياري</small><input name=\"imageUrl\" type=\"url\"></label></div><p id=\"merchant-message-status\" role=\"status\" aria-live=\"polite\"></p></div><footer class=\"offer-editor-footer\"><span>لن تُرسل الرسالة إلا بعد الضغط على «إرسال الرسالة».</span><button type=\"submit\" class=\"btn-primary\">إرسال الرسالة</button></footer></form>";
  document.body.append(dialog);
  const form = dialog.querySelector("form"),
    status = dialog.querySelector("#merchant-message-status"),
    send = form.querySelector("[type=submit]");
  let busy = false;
  function fields() {
    for (const [selector, key, value] of [
      ["[data-city]", "targetAudience", "by_city"],
      ["[data-category]", "targetAudience", "by_category"],
      ["[data-schedule]", "sendTime", "scheduled"],
    ]) {
      const section = form.querySelector(selector),
        active = form.elements[key].value === value;
      section.hidden = !active;
      section.querySelector("input,select").required = active;
    }
  }
  open.onclick = () => {
    if (!window.PromotionsWorkspace?.canMessage()) {
      window.alert(
        "يتطلب إرسال الرسائل إلى المتاجر صلاحية اعتماد العروض على مستوى المنصة.",
      );
      return;
    }
    status.textContent = window.WIZZCENTRAL_CONFIG.PUSH_NOTIFICATION_API_URL
      ? "راجع الجمهور المستهدف ونص الرسالة قبل الإرسال."
      : "خدمة مراسلة المتاجر غير مهيّأة في هذه البيئة.";
    send.disabled = !window.WIZZCENTRAL_CONFIG.PUSH_NOTIFICATION_API_URL;
    fields();
    dialog.showModal();
  };
  dialog.querySelector(".icon-button").onclick = () => {
    if (!busy) dialog.close();
  };
  dialog.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  form.onchange = fields;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!window.PromotionsWorkspace?.canMessage()) {
      status.textContent = "لا تملك صلاحية إرسال هذه الرسالة.";
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    for (const field of ["city", "businessCategory", "actionUrl", "imageUrl"])
      if (!data[field]) delete data[field];
    if (data.targetAudience !== "by_city") delete data.city;
    if (data.targetAudience !== "by_category") delete data.businessCategory;
    if (data.sendTime === "scheduled") {
      data.scheduledTime = new Date(
        data.scheduledTime + ":00+03:00",
      ).toISOString();
      if (Date.parse(data.scheduledTime) <= Date.now()) {
        status.textContent = "اختر موعد إرسال في المستقبل.";
        return;
      }
    } else delete data.scheduledTime;
    delete data.sendTime;
    busy = true;
    send.disabled = true;
    status.textContent = "جارٍ الإرسال…";
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 30000);
    try {
      await window.Auth.ensureSession();
      const token =
        window.Auth.getIdToken?.() || window.Auth.getToken("idToken");
      if (!token) throw Error("Please sign in again.");
      const response = await fetch(
        window.WIZZCENTRAL_CONFIG.PUSH_NOTIFICATION_API_URL.replace(/\/$/, "") +
          "/api/merchants/send-info-notification",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success)
        throw Error(result.message || "Could not send the message.");
      status.textContent =
        "قُبلت الرسالة. عدد الجهات المستهدفة: " +
        (result.targeted ?? "—") +
        " · أُرسلت: " +
        (result.sent ?? "—") +
        " · تعذّر الإرسال: " +
        (result.failed ?? "—");
    } catch (e) {
      status.textContent =
        e.name === "AbortError"
          ? "انتهت مهلة الطلب. تحقّق من حالة الإرسال قبل إعادة المحاولة لتجنّب التكرار."
          : window.WizzLocale.error(e.message);
    } finally {
      clearTimeout(timer);
      busy = false;
      send.disabled = false;
    }
  };
})();
