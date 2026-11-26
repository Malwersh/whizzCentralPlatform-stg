'use strict';

const { createHash } = require('node:crypto');
const { error } = require('./policy');

function customerPhoneClosureKey(phone) {
 if(typeof phone!=='string'||!/^\+9647\d{9}$/.test(phone))throw error('INVALID_CUSTOMER_PHONE_BINDING');
 return {pk:'CUSTOMER_PHONE_CLOSURE#'+createHash('sha256').update(phone).digest('hex'),sk:'META'};
}

module.exports={customerPhoneClosureKey};
