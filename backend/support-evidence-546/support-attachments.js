'use strict';
const {GetCommand} = require('@aws-sdk/lib-dynamodb');
const {createHash} = require('node:crypto');
const {isRetained} = require('../staff-service/complaint-image-retention');
function isUsable(row, now=Date.now()/1000) { return !!row && ((Number.isFinite(row.ttl) && row.ttl>now) || isRetained(row)); }
const MAX_BYTES = 2 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code, status = 400) => Object.assign(new Error(code), {code, status});
const crcTable = Array.from({length: 256}, (_, n) => {
    let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(data) {
    let c = 0xffffffff; for (const b of data) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function validateImage(data, contentType) {
    if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_BYTES) throw fail('IMAGE_SIZE_INVALID');
    let width, height;
    if (contentType === 'image/png' && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a','hex'))) {
        let offset = 8, sawData = false, sawEnd = false;
        while (offset + 12 <= data.length) {
            const length = data.readUInt32BE(offset), end = offset + 12 + length;
            if (end > data.length) throw fail('IMAGE_INVALID');
            const type = data.toString('ascii', offset + 4, offset + 8);
            if (crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) throw fail('IMAGE_INVALID');
            if (offset === 8) {
                if (type !== 'IHDR' || length !== 13) throw fail('IMAGE_INVALID');
                width = data.readUInt32BE(offset + 8); height = data.readUInt32BE(offset + 12);
            } else if (type === 'IHDR') throw fail('IMAGE_INVALID');
            if (type === 'IDAT') sawData = true;
            if (type === 'IEND') { if (length || end !== data.length) throw fail('IMAGE_INVALID'); sawEnd = true; break; }
            offset = end;
        }
        if (!sawData || !sawEnd) throw fail('IMAGE_INVALID');
    } else if (contentType === 'image/jpeg' && data[0] === 255 && data[1] === 216 && data.at(-2) === 255 && data.at(-1) === 217) {
        let offset = 2, sawScan = false;
        while (offset + 4 <= data.length) {
            if (data[offset++] !== 255) throw fail('IMAGE_INVALID');
            while (data[offset] === 255) offset++;
            const marker = data[offset++];
            if (offset + 2 > data.length - 2) throw fail('IMAGE_INVALID');
            const length = data.readUInt16BE(offset);
            if (marker === 0xda) {
                if (!width || length < 6 || offset + length >= data.length - 2) throw fail('IMAGE_INVALID');
                sawScan = true; break;
            }
            if (length < 2 || offset + length > data.length) throw fail('IMAGE_INVALID');
            if ([0xc0,0xc1,0xc2].includes(marker)) {
                if (length < 8) throw fail('IMAGE_INVALID');
                height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5);
            }
            offset += length;
        }
        if (!sawScan) throw fail('IMAGE_INVALID');
    } else throw fail('IMAGE_TYPE_INVALID');
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16000000) throw fail('IMAGE_DIMENSIONS_INVALID');
    return {size: data.length, checksum: createHash('sha256').update(data).digest('base64'), contentType};
}
async function getAttachment(db, table, attachmentId) {
    if (!table) throw fail('ATTACHMENTS_UNAVAILABLE', 503);
    if (!ID.test(attachmentId || '')) throw fail('ATTACHMENT_INVALID');
    const row = (await db.send(new GetCommand({TableName: table, Key: {attachmentId}, ConsistentRead: true}))).Item;
    if (!isUsable(row)) throw fail('ATTACHMENT_UNAVAILABLE', 404);
    return row;
}
function reference(row) { return {attachmentId: row.attachmentId, contentType: row.contentType, size: row.size}; }
module.exports = {MAX_BYTES, ID, fail, validateImage, getAttachment, reference, isUsable};
