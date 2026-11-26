'use strict';
// Exact source edits for a downloaded live package. No AWS client and no deployment.
const crypto = require('node:crypto');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function replaceOnce(source, before, after) {
 if (!before || source.split(before).length !== 2) throw Error('LIVE_SOURCE_ANCHOR_CHANGED');
 return source.replace(before, after);
}
function between(source, start, end) {
 const offset = source.indexOf(start), stop = source.indexOf(end, offset + start.length);
 if (offset < 0 || stop < 0 || source.indexOf(start, offset + 1) >= 0) throw Error('LIVE_SOURCE_ANCHOR_CHANGED');
 return source.slice(offset, stop);
}
function patchLiveOrder(live, local, expectedSha256) {
 if (sha256(live) !== expectedSha256) throw Error('LIVE_SOURCE_DIGEST_CHANGED');
 // The historical patch cannot compose the live offer journey/audience fences.
 // Keep it fail-closed after source adoption; use a fresh commercial-runtime overlay.
 if (local.includes("require('../shared/offer-context')")) throw Error('LEGACY_QUOTE_PATCH_RETIRED');
 const edits = [];
 const edit = (before, after) => { live = replaceOnce(live, before, after); edits.push({before, after}); };
 edit("const { v4: uuidv4 } = require('uuid');", "const { accountGuard } = require('./account-guard');\nconst { createStagingQuoteOrder, QuoteOrderError } = require('./quote-runtime/deliveryQuoteOrder');\nconst { CognitoIdentityProviderClient, GetUserCommand } = require('../delivery-quotes/runtime');\nconst quoteCognito = new CognitoIdentityProviderClient({});\nconst { v4: uuidv4 } = require('uuid');");
 const oldAuth = between(live, '        // If an auth token exists,', '        // Validate items array');
 const newAuth = between(local, "        const profilesTable = requireEnv('USERS_TABLE');", '        // Validate items array')
  .replace('cognito.getUser({AccessToken:token}).promise()', 'quoteCognito.send(new GetUserCommand({AccessToken:token}))');
 edit(oldAuth, newAuth);
 const mode = between(local, '        // Local quoted flow is disabled', '        // CRITICAL BUSINESS RULE:');
 edit('        // CRITICAL BUSINESS RULE:', mode + '        // CRITICAL BUSINESS RULE:');
 edit('const orderId = uuidv4();', 'const orderId = quotedOrder ? quotedOrder.orderId : uuidv4();');
 edit('const deliveryFee = Math.round((body.deliveryFee || 10) * 1000);', 'const deliveryFee = quotedOrder ? quotedOrder.deliveryFeeMinor : Math.round((body.deliveryFee || 10) * 1000);');
 const routing = between(local, '        if (quotedOrder) {\n            // Bind operational routing', "        console.log('Creating order'");
 edit("        console.log('Order to be created:'", routing + "        console.log('Order to be created:'");
 edit('            await dynamoDb.send(new TransactWriteCommand({TransactItems: [', `            if (quotedOrder) {
                const saved = await quotedOrder.commit(order);
                if (saved.replayed) return quotedResponse(saved.order, true);
                Object.assign(order, saved.order);
            } else await dynamoDb.send(new TransactWriteCommand({TransactItems: [
                ...(guardedAccount.condition ? [guardedAccount.condition] : []),`);
 const catchStart = live.indexOf("        console.error('Error creating order:', error);");
 const tail = live.slice(catchStart);
 const changedTail = replaceOnce(tail, '            statusCode: 500,', '            statusCode: error.statusCode || 500,');
 edit(tail, changedTail.replace('                errorName: error.name,', `                errorName: error.name,
                ...(error instanceof QuoteOrderError ? {code: error.code} :
                    ['QUOTE_NOT_ENABLED','QUOTE_NOT_CONFIGURED'].includes(error.message) ? {code: error.message} : {}),`));
 // Reversibility proves all source outside these exact edits is preserved, including discounts/counters/notifications.
 let restored = live;
 for (const {before, after} of [...edits].reverse()) restored = replaceOnce(restored, after, before);
 if (sha256(restored) !== expectedSha256) throw Error('LIVE_SOURCE_PRESERVATION_FAILED');
 return {source: live, originalSha256: expectedSha256, candidateSha256: sha256(live), edits};
}
module.exports = {sha256, replaceOnce, patchLiveOrder};
