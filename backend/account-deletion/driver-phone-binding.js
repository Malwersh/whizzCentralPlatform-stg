'use strict';

const { createHash } = require('node:crypto');

function driverPhoneClosureKey(phone) {
  if (typeof phone !== 'string' || !/^\+9647\d{9}$/.test(phone)) throw Error('INVALID_DRIVER_PHONE_BINDING');
  return { pk:'DRIVER_PHONE_CLOSURE#'+createHash('sha256').update(phone).digest('hex'), sk:'META' };
}

module.exports = { driverPhoneClosureKey };
