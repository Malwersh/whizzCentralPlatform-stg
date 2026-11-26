'use strict';

const {createHash, randomUUID} = require('node:crypto');
const {S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand} = require('@aws-sdk/client-s3');
const {getSignedUrl} = require('@aws-sdk/s3-request-presigner');

const bucket = 'wizz-production-home-slides-746727375268';
const campaignImageKey = key => typeof key === 'string' &&
  /^home-slideshow\/campaigns-[a-f0-9]{64}\/[a-f0-9-]{36}\.(?:jpg|gif)$/.test(key);
const campaignOwnerPrefix = employeeId => 'home-slideshow/campaigns-' +
  createHash('sha256').update(employeeId).digest('hex') + '/';

const {decodeImage, validImageMetadata} = require('../../../backend/staff-service/home-slide-contract');
const navigationPrefix = employeeId => 'home-slideshow/navigation-' +
  createHash('sha256').update(employeeId).digest('hex') + '/';
const navigationImage = key => typeof key === 'string' &&
  /^home-slideshow\/navigation-[a-f0-9]{64}\/[a-f0-9-]{36}\.(jpg|gif)$/.test(key);

async function uploadNavigationImage(assets, actor, input) {
  const {body, extension} = decodeImage(input);
  const imageKey = navigationPrefix(actor.employeeId) + randomUUID() + '.' + extension;
  await assets.put(imageKey, body);
  return { imageKey, imageUrl: await assets.url(imageKey) };
}

async function checkNavigationImages(assets, actor, items, current) {
  const previous = new Set([current.draftNavigation, current.published?.navigation,
    ...(current.history ?? []).map(item => item.navigation)]
    .flatMap(nav => (nav?.items ?? []).map(item => item.imageKey)));
  for (const key of new Set(items.map(item => item.imageKey).filter(Boolean))) {
    if (!navigationImage(key) || (!previous.has(key) && !key.startsWith(navigationPrefix(actor.employeeId))) ||
        !validImageMetadata(key, await assets.head(key) ?? {})) {
      throw Object.assign(new Error('NAVIGATION_IMAGE_INVALID'), { status: 400 });
    }
  }
}

function createAssets(s3 = new S3Client({region:'us-east-1',maxAttempts:2})) {
  const object = Key => ({Bucket:bucket,Key});
  return {
    put: (Key, Body) => s3.send(new PutObjectCommand({
      ...object(Key), Body, ContentType: Key.endsWith('.gif') ? 'image/gif' : 'image/jpeg',
      CacheControl: 'private, max-age=900', ServerSideEncryption: 'AES256',
    })),
    head: async Key => {
      try { return await s3.send(new HeadObjectCommand(object(Key))); }
      catch (error) {
        if (['NotFound','NoSuchKey','Forbidden'].includes(error.name)) return null;
        throw error;
      }
    },
    url: Key => getSignedUrl(s3, new GetObjectCommand(object(Key)), {expiresIn:900}),
  };
}

module.exports = {bucket, createAssets, campaignImageKey, campaignOwnerPrefix, navigationImage, uploadNavigationImage, checkNavigationImages};
