'use strict';

const { createHash } = require('node:crypto');

function merchantPhoneClosureKey(phone) {
  if (typeof phone !== 'string' || !/^\+9647\d{9}$/.test(phone)) throw Error('INVALID_MERCHANT_PHONE_BINDING');
  return { pk: 'MERCHANT_PHONE_CLOSURE#' + createHash('sha256').update(phone).digest('hex'), sk: 'META' };
}

module.exports = { merchantPhoneClosureKey };
