'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { chromium } = require('playwright');
const site = 'https://wizz.test';
const root = path.resolve(process.env.WIZZ_ADMIN_WEB_BUILD);
const queueKey = '2026-11-24T10:00:00.000Z#aaaaaaaa-0000-0000-0000-000000000004';
const applicant = {
  queueKey, name: 'مطعم الاختبار', version: 2, type: 'RESTAURANT', region: 'مركز المناذرة',
  address: 'شارع رئيسي', submittedAt: '2026-11-24T10:00:00.000Z', termsVersion: 'terms-1',
  canReview: true, canReadDocuments: true, documents: [{ kind: 'registration', id: 'doc-1' }],
};
const branch = {
  businessId: 'business-1', name: applicant.name, type: applicant.type, status: 'approved', region: applicant.region,
  address: applicant.address, active: false, acceptingOrders: false, menuPublished: false, agreement: { status: 'UNASSIGNED' },
};

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      let approved = false;
      let ordersBlocked = false;
      let controlRevision = 'a'.repeat(64);
      let changeReviewed = false;
      let transferPhoneVerified = false;
      let transferSettlementApproved = false;
      let transferRejected = false;
      let transferCompleted = false;
      let agreement, storeAccepted = false;
      await page.route(site + '/**', async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/assets/js/auth-utils.js') {
          return route.fulfill({ contentType: 'application/javascript',
            body: 'window.Auth={ensureSession:()=>Promise.resolve(),getToken:()=>"test",requireAuthentication:()=>true};' });
        }
        if (pathname === '/staff/merchants/applications') return route.fulfill({ json: { items: approved ? [] : [applicant] } });
        if (pathname === '/staff/merchants/directory') return route.fulfill({ json: {
          items: approved ? [{...branch, ordersBlocked}] : [],
        } });
        if (pathname === '/staff/merchants/changes') {
          if (request.method() === 'GET') return route.fulfill({json: {items: changeReviewed ? [] : [{
            requestId: '922ccbae-fdfc-4fcd-a98d-50c4e65eb5c0', version: 1, businessName: 'مطعم الاختبار',
            kind: 'LOCATION', createdAt: '2026-11-24T10:00:00.000Z', previous: 'العنوان المعتمد',
            proposed: {address: 'العنوان الجديد', latitude: 32, longitude: 44},
            regionNames: ['العراق','النجف','مركز المناذرة'], reason: 'انتقل الفرع', canReview: width !== 320,
          }]}});
          const body = request.postDataJSON();
          assert.deepEqual(body, {requestId: '922ccbae-fdfc-4fcd-a98d-50c4e65eb5c0', baseVersion: 1,
            decision: 'APPROVE', reason: 'طابقنا موقع الفرع'});
          changeReviewed = true;
          return route.fulfill({json: {status: 'APPROVED'}});
        }
        if (pathname === '/staff/merchants/lifecycle/decision') {
          const body = request.postDataJSON();
          assert.equal(request.headers().authorization, 'Bearer test');
          assert.equal(body.organizationId, 'org-1');
          assert.equal(body.requestId, 'transfer-1');
          assert.equal(body.baseVersion, 2);
          if (body.decision === 'APPROVE_SETTLEMENT') {
            assert.equal(body.profileVersion, 3);
            assert.equal(body.proofVersion, 4);
            assert.equal(body.reason, 'طابقنا هاتف التسويات');
            transferSettlementApproved = true;
            return route.fulfill({ json: { status: 'AWAITING_REVIEW', settlement: 'APPROVED' } });
          }
          if (body.decision === 'APPROVE') {
            assert.equal(body.proofVersion, undefined);
            assert.equal(body.reason, 'استكملنا مراجعة النقل');
            transferCompleted = true;
            return route.fulfill({ json: { status: 'COMPLETED' } });
          }
          assert.equal(body.decision, 'REJECT');
          assert.equal(body.reason, 'الطلب يحتاج مراجعة جديدة');
          assert.equal(body.proofVersion, undefined);
          transferRejected = true;
          return route.fulfill({ json: { status: 'REJECTED' } });
        }
        if (pathname === '/staff/merchants/lifecycle') {
          const query = new URL(request.url()).searchParams;
          assert.equal(request.headers().authorization, 'Bearer test');
          const transfer = { kind: 'ownership', organizationId: 'org-1', requestId: 'transfer-1', name: branch.name,
            branchCount: 1, status: transferCompleted ? 'COMPLETED' : 'AWAITING_REVIEW',
            completedAt: transferCompleted ? Date.now() : null };
          if (query.has('requestId')) {
            assert.equal(query.get('organizationId'), transfer.organizationId);
            const settlement = transferSettlementApproved ? 'APPROVED' :
              transferPhoneVerified ? 'REVIEW_REQUIRED' : 'VERIFICATION_REQUIRED';
            const blocker = {
              VERIFICATION_REQUIRED: 'TRANSFER_DESTINATION_VERIFICATION_REQUIRED',
              REVIEW_REQUIRED: 'TRANSFER_SETTLEMENT_APPROVAL_REQUIRED',
            }[settlement];
            return route.fulfill({ json: { request: transfer, canCheck: true, canReject: !transferCompleted, baseVersion: 2,
              canApprove: width === 1280 && transferSettlementApproved && !transferCompleted,
              checkedAt: transferCompleted ? null : Date.now(), settlement, maskedPhone: transferPhoneVerified ? '••••0000' : undefined,
              canApproveSettlement: settlement === 'REVIEW_REQUIRED', settlementEvidence: {profileVersion: 3, proofVersion: 4},
              blockers: blocker ? [{code: blocker}] : [],
              branches: [{ businessId: branch.businessId, name: branch.name, blockers: width === 1280 && transferSettlementApproved ? [] : [
                {code: 'ACTIVE_ORDERS', count: 2}, {code: 'ACTIVE_MEMBERSHIPS', count: 1},
              ] }],
            } });
          }
          const kind = query.get('kind') || 'ownership';
          return route.fulfill({ json: { kind, available: { ownership: true, closure: true }, items: kind === 'ownership' ? (transferRejected || transferCompleted ? [] : [transfer]) : [{
            kind, scope: 'BUSINESS', name: branch.name, requestId: 'closure-1', status: 'PENDING_SETTLEMENT',
            blockers: [{ code: 'LOCKED_BALANCE', amount: 121000 }],
          }] } });
        }
        if (pathname === '/staff/order-monitoring') {
          assert.equal(new URL(request.url()).searchParams.get('branch'), branch.businessId);
          return route.fulfill({json: {items: [{orderId:'order-1', orderNumber:'ORD12345', status:'confirmed', createdAt:applicant.submittedAt}]}});
        }
        if (pathname === '/staff/order-monitoring/followup' || pathname === '/staff/order-monitoring/followup/policy') {
          return route.fulfill({status:403, json:{error:'PERMISSION_REQUIRED'}});
        }
        if (pathname === '/staff/merchants/agreements') {
          if (request.method() === 'GET') return route.fulfill({ json: {
            items: agreement ? [{ ...agreement, ownerAccepted: storeAccepted, requestedByMe: true }] : [],
            branches: [{ id: branch.businessId, name: branch.name }], can: { request: true, approve: true },
          } });
          const proposal = request.postDataJSON();
          assert.equal(proposal.businessId, branch.businessId);
          if (proposal.action === 'SAVE_AGREEMENT') {
            assert.deepEqual(proposal.values.commission.rate, { numerator: 1250, denominator: 10000 });
            assert.equal(proposal.values.serviceFee.kind, 'NONE');
            agreement = { draft: { id: proposal.id, version: 1, baseVersion: 0,
              values: proposal.values, businessIds: proposal.businessIds, hash: 'contract-fingerprint' } };
          } else {
            assert.equal(proposal.action, 'APPROVE_AGREEMENT');
            assert.equal(proposal.hash, 'contract-fingerprint');
            agreement.draft.publishedVersion = 1;
          }
          return route.fulfill({ json: { saved: true } });
        }
        if (pathname === '/staff/merchants/branch') return route.fulfill({ json: {
          ...branch, ordersBlocked, control: {revision: controlRevision,
            actions: [ordersBlocked ? 'RESUME_ORDERS' : 'PAUSE_ORDERS', 'SUSPEND'],
            reason: ordersBlocked ? 'الإيقاف مؤقت للصيانة' : null},
        } });
        if (pathname === '/staff/merchants/control') {
          const body = request.postDataJSON();
          assert.equal(body.businessId, branch.businessId);
          assert.equal(body.baseRevision, controlRevision);
          assert.equal(request.headers().authorization, 'Bearer test');
          assert.equal(body.action, ordersBlocked ? 'RESUME_ORDERS' : 'PAUSE_ORDERS');
          ordersBlocked = body.action === 'PAUSE_ORDERS';
          controlRevision = (ordersBlocked ? 'b' : 'c').repeat(64);
          return route.fulfill({json: {saved: true, branch: {...branch, ordersBlocked}}});
        }
        if (pathname.endsWith('/application-asset')) return route.fulfill({
          json: { url: 'https://wizz-production-merchant-onboarding-746727375268.s3.us-east-1.amazonaws.com/synthetic' },
        });
        if (pathname.endsWith('/applications/review')) {
          const body = request.postDataJSON();
          assert.deepEqual(body, { queueKey, baseVersion: 2, decision: 'APPROVE', reason: 'تمت مراجعة الشهادة' });
          approved = true;
          return route.fulfill({ json: { businessId: branch.businessId, status: 'APPROVED' } });
        }
        const contentType = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.ttf': 'font/ttf' }[path.extname(pathname)];
        return route.fulfill({ contentType, body: await readFile(path.join(root, pathname)) });
      });
      await page.goto(site + '/pages/merchants.html');
      await page.getByRole('button', { name: 'عرض الطلب' }).waitFor({ timeout: 10000 });
      assert.equal(await page.locator('nav a[aria-current="page"]').innerText(), 'المطاعم والفروع');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const lifecycle = page.getByRole('tab', { name: 'الملكية والإغلاق' });
      await lifecycle.click();
      await page.getByRole('button', { name: 'عرض تفاصيل الطلب' }).click();
      const lifecycleDialog = page.getByRole('dialog');
      await lifecycleDialog.getByRole('heading', { name: 'ينتظر تأكيد هاتف التسويات' }).waitFor();
      assert.equal(await lifecycleDialog.getByRole('link', { name: 'فتح متابعة الطلبات' }).getAttribute('href'),
        '/pages/order-monitoring.html?branch=business-1#orders-title');
      assert.equal(await lifecycleDialog.getByRole('link', { name: 'فتح ملف الفرع' }).getAttribute('href'),
        '/pages/merchants.html?tab=branches&branchId=business-1');
      assert.equal(await lifecycleDialog.getByRole('option', { name: 'اعتماد نقل الملكية' }).count(), 0);
      if (width !== 320) {
        transferPhoneVerified = true;
        await lifecycleDialog.getByRole('button', { name: 'إعادة فحص الموانع' }).click();
        await lifecycleDialog.getByText('••••0000', {exact:true}).waitFor();
        await lifecycleDialog.getByRole('button', { name: 'انتقل إلى اعتماد وجهة التسويات' }).click();
        await lifecycleDialog.getByRole('textbox', { name: 'سبب القرار' }).fill('طابقنا هاتف التسويات');
        await lifecycleDialog.getByRole('button', { name: 'تأكيد القرار' }).click();
        await lifecycleDialog.getByText('اعتمدت الإدارة وجهة التسويات.').waitFor();
        if (width === 1280) {
          await lifecycleDialog.getByRole('button', { name: 'انتقل إلى اعتماد نقل الملكية' }).click();
          await lifecycleDialog.getByRole('textbox', { name: 'سبب القرار' }).fill('استكملنا مراجعة النقل');
          await lifecycleDialog.getByRole('button', { name: 'تأكيد القرار' }).click();
          const commercialLink = lifecycleDialog.getByRole('link', {name: 'فتح ملف الفرع لمراجعة الاتفاقية التجارية'});
          await commercialLink.waitFor();
          assert.equal(await commercialLink.getAttribute('href'), '/pages/merchants.html?tab=branches&branchId=business-1');
          await lifecycleDialog.getByRole('button', { name: 'إغلاق', exact: true }).click();
        } else {
          await lifecycleDialog.getByLabel('الإجراء', {exact:true}).selectOption('REJECT');
          await lifecycleDialog.getByRole('textbox', { name: 'سبب القرار' }).fill('الطلب يحتاج مراجعة جديدة');
          await lifecycleDialog.getByRole('button', { name: 'تأكيد القرار' }).click();
          await page.getByText('سُجّل رفض طلب النقل ورُفع قيده عن الفروع المشمولة.').waitFor();
        }
      } else {
        await lifecycleDialog.getByRole('button', { name: 'إغلاق', exact: true }).click();
      }
      await page.getByLabel('نوع الطلب').selectOption('closure');
      await page.getByRole('button', { name: 'عرض تفاصيل الطلب' }).click();
      await lifecycleDialog.getByRole('heading', { name: 'رصيد محجوز' }).waitFor();
      assert.equal(await lifecycleDialog.getByRole('link', { name: 'فتح المحافظ' }).getAttribute('href'), '/pages/wallets.html#wallets');
      await lifecycleDialog.getByRole('button', { name: 'إغلاق', exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('tab', { name: 'طلبات الانضمام' }).click();
      if (width === 390) {
        await page.getByRole('button', { name: 'عرض الطلب' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'عرض شهادة التسجيل' }).click();
        await dialog.getByRole('link', { name: 'فتح المستند خلال دقيقة' }).waitFor();
        const applicationForm = dialog.locator('#merchant-decision');
        await applicationForm.getByLabel('القرار', { exact: true }).selectOption('APPROVE');
        await applicationForm.getByLabel('سبب القرار').fill('تمت مراجعة الشهادة');
        await dialog.getByRole('button', { name: 'تأكيد القرار' }).click();
        await page.getByText('لا توجد طلبات بانتظار المراجعة.', { exact: true }).waitFor({ timeout: 10000 });
        await page.getByRole('tab', { name: 'الفروع المسجّلة' }).click();
        await page.getByRole('button', { name: 'ملف الفرع' }).click();
        await dialog.getByText('بانتظار ربط اتفاقية', { exact: true }).waitFor({ timeout: 10000 });
        await dialog.getByText('بانتظار نشر القائمة', { exact: true }).waitFor({ timeout: 10000 });
        await dialog.getByRole('button', { name: 'الاتفاقيات التجارية', exact: true }).click();
        await dialog.getByRole('button', { name: 'إعداد اتفاقية', exact: true }).click();
        const commission = dialog.getByRole('group', { name: 'عمولة المنصة' });
        await commission.locator('select').first().selectOption('PERCENT');
        await commission.getByRole('spinbutton').fill('12.5');
        await dialog.getByRole('group', { name: 'رسم الخدمة على الزبون' }).locator('select').first().selectOption('NONE');
        await dialog.getByLabel('سبب الإعداد').fill('شروط عمولة الفرع');
        await dialog.getByRole('button', { name: 'إرسال الشروط إلى المالك' }).click();
        await dialog.getByText('بانتظار قبول المالك', { exact: true }).waitFor();
        storeAccepted = true;
        await dialog.getByRole('button', { name: 'تحديث الاتفاقيات' }).click();
        await dialog.getByRole('button', { name: 'اعتماد الاتفاقية', exact: true }).click();
        await dialog.getByLabel('سبب الاعتماد').fill('تحققت من موافقة المالك');
        await dialog.getByRole('button', { name: 'تأكيد الاعتماد' }).click();
        await dialog.getByText('معتمدة · الإصدار 1', { exact: true }).waitFor();
        await dialog.getByLabel('إجراء المنصة').selectOption('PAUSE_ORDERS');
        await dialog.getByLabel('سبب الإجراء').fill('الإيقاف مؤقت للصيانة');
        await dialog.getByRole('button', {name: 'تأكيد الإجراء'}).click();
        await dialog.getByText('الطلبات الجديدة ممنوعة', {exact: true}).waitFor();
        await dialog.getByText('الإيقاف مؤقت للصيانة', {exact: true}).waitFor();
        await dialog.getByLabel('إجراء المنصة').selectOption('RESUME_ORDERS');
        await dialog.getByLabel('سبب الإجراء').fill('انتهت أعمال الصيانة');
        await dialog.getByRole('button', {name: 'تأكيد الإجراء'}).click();
        await dialog.getByText('تم تسجيل الإجراء.', {exact: true}).waitFor();
        assert.ok(!ordersBlocked);
        await dialog.getByRole('button', {name: 'إغلاق', exact: true}).click();
      }
      await page.getByRole('tab', {name: 'تعديلات الاسم والموقع'}).click();
      assert.ok(new URL(page.url()).searchParams.get('tab') === 'changes');
      await page.getByRole('button', {name: 'عرض التعديل'}).click();
      const changeDialog = page.getByRole('dialog');
      await changeDialog.getByText('العنوان المعتمد', {exact: true}).waitFor();
      await changeDialog.getByText('العنوان الجديد', {exact: true}).waitFor();
      if (width === 320) {
        assert.ok(!await changeDialog.getByRole('button', {name: 'تأكيد القرار'}).isVisible());
      } else {
        const changeForm = changeDialog.locator('#merchant-change-decision');
        await changeForm.getByLabel('القرار', {exact: true}).selectOption('APPROVE');
        await changeForm.getByLabel('سبب القرار').fill('طابقنا موقع الفرع');
        await changeDialog.getByRole('button', {name: 'تأكيد القرار'}).click();
        await page.getByText('اعتُمد التعديل وحُدّثت بيانات الفرع.').waitFor();
      }
      if (width === 390) {
        await page.goto(site + '/pages/order-monitoring.html?branch=business-1#orders-title');
        await page.getByRole('button', { name: /ORD12345/ }).waitFor();
        assert.equal(await page.locator('#branch-selector').inputValue(), branch.businessId);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Merchant review verified at 320, 390 and 1280 px, including merchant lifecycle cases, blocker navigation and branch review.');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
