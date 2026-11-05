'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture({fetcher, auth = async () => {}, endpoint = 'https://support.invalid/images'} = {}) {
  const requests = [], revoked = [], timers = new Set();
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.isConnected = true; }
    appendChild(child) { this.children.push(child); }
    addEventListener(name, fn) { this[name] = fn; }
    remove() { this.removed = true; }
  }
  class LocalURL extends URL {}
  LocalURL.createObjectURL = () => 'blob:private-preview';
  LocalURL.revokeObjectURL = url => revoked.push(url);
  const sandbox = {
    document: {createElement: tag => new Element(tag)}, URL: LocalURL, Blob, Uint8Array, AbortController,
    atob, setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
    WIZZCENTRAL_CONFIG: {SUPPORT_ATTACHMENTS_API_URL: endpoint},
    Auth: {ensureSession: auth, getToken: () => 'renewed-token'},
    fetch: async (url, options) => { requests.push({url, options}); return fetcher ? fetcher() : reply(); }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync('frontend/js/support/SupportAttachments.js', 'utf8'), sandbox);
  const container = sandbox.SupportAttachments.createPreview({attachmentId: 'image-1'}, 'session-1');
  return {container, button: container.children[0], requests, revoked, timers};
}
function reply(payload = {attachmentId: 'image-1', contentType: 'image/png', dataBase64: 'aGVsbG8='}) {
  return {ok: true, headers: {get: () => null}, text: async () => JSON.stringify(payload)};
}
test('preview waits for a click and authenticates a session-bound private request', async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0);
  await f.button.click();
  const request = f.requests[0];
  assert.equal(new URL(request.url).searchParams.get('sessionId'), 'session-1');
  assert.equal(request.options.headers.Authorization, 'Bearer renewed-token');
  assert.equal(request.options.cache, 'no-store');
  const img = f.container.children[1];
  assert.equal(img.src, 'blob:private-preview');
  img.onload();
  assert.deepEqual(f.revoked, ['blob:private-preview']);
  assert.equal(f.timers.size, 0);
});
test('expired authentication does not fetch and permits retry', async () => {
  const f = fixture({auth: async () => { throw Error('expired'); }});
  await f.button.click();
  assert.equal(f.requests.length, 0);
  assert.equal(f.button.disabled, false);
  assert.match(f.button.textContent, /إعادة المحاولة/);
});
test('removed conversation during authentication does not fetch', async () => {
  let resume;
  const f = fixture({auth: () => new Promise(resolve => { resume = resolve; })});
  const pending = f.button.click();
  f.container.isConnected = false;
  resume(); await pending;
  assert.equal(f.requests.length, 0);
});
for (const payload of [
  {attachmentId: 'other', contentType: 'image/png', dataBase64: 'aGVsbG8='},
  {attachmentId: 'image-1', contentType: 'image/svg+xml', dataBase64: 'aGVsbG8='},
]) test('mismatched or unsupported image is never inserted: ' + payload.contentType + '/' + payload.attachmentId, async () => {
  const f = fixture({fetcher: () => reply(payload)});
  await f.button.click();
  assert.equal(f.container.children.length, 1);
  assert.match(f.button.textContent, /إعادة المحاولة/);
});
test('oversized body without content-length is rejected', async () => {
  const f = fixture({fetcher: () => ({ok: true, headers: {get: () => null}, text: async () => ' '.repeat(3*1024*1024+1)})});
  await f.button.click();
  assert.equal(f.container.children.length, 1);
  assert.match(f.button.textContent, /إعادة المحاولة/);
});
test('failed image decoding revokes the private URL and offers retry', async () => {
  const f = fixture(); await f.button.click();
  const img = f.container.children[1]; img.onerror();
  assert.equal(img.removed, true);
  assert.equal(f.button.hidden, false);
  assert.deepEqual(f.revoked, ['blob:private-preview']);
});
