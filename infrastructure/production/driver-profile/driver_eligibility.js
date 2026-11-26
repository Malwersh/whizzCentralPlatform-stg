'use strict';

// ACTIVE historically means profile completion, not administrative approval.
function isDriverApproved(driver) {
  if (!driver) return false;
  const status = String(driver.status || '').toUpperCase();
  const review = String(driver.registrationStatus || '').toUpperCase();
  const blocked = ['BANNED', 'SUSPENDED', 'REJECTED', 'PENDING_REVIEW', 'PENDING_PROFILE', 'PENDING_DOCS'];
  if (blocked.includes(status) || blocked.includes(review)) return false;
  return ['APPROVED', 'VERIFIED'].includes(status) ||
    ['APPROVED', 'VERIFIED'].includes(review) ||
    driver.isVerified === true || driver.is_verified === true || driver.documentsVerified === true;
}
module.exports = { isDriverApproved };
