'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { decodeImage, eligible, validImageMetadata, validate } = require('../../../backend/staff-service/home-slide-contract');
const { allowed } = require('../driver-review/catalog');

const campaigns = require('./campaigns.cjs');
const isOffer = action => ['campaign', 'discount'].includes(action.type);
const KEY = { pk: 'HOME_SLIDESHOW', sk: 'CURRENT' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const get = async (ctx, TableName, Key) =>
  (await ctx.db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
const ownerPrefix = actor => 'home-slideshow/' +
  createHash('sha256').update(actor.employeeId).digest('hex') + '/';
const order = (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id);

async function state(ctx) {
  return await get(ctx, ctx.table, KEY) || { ...KEY, version: 0, slides: [] };
}

async function destinationAvailable(ctx, slide) {
  if (slide.action.type === 'announcement') return true;
  if (isOffer(slide.action)) return campaigns.slideTargetAvailable(ctx.db, slide);
  const branch = await get(ctx, ctx.homeTables.merchants, { businessId: slide.action.id });
  return ctx.selectableMerchant(branch);
}

async function validateContent(ctx, actor, raw, prior) {
  const slide = validate({ ...raw, status: 'draft' }, { allowAnnouncement: true });
  if (!['announcement', 'merchant', 'campaign', 'discount'].includes(slide.action.type) ||
      (slide.action.type === 'announcement' && slide.action.id !== slide.id)) {
    throw fail('SLIDE_DESTINATION_INVALID');
  }
  const previousImages = [prior?.draft?.imageKey, prior?.published?.imageKey];
  if (!previousImages.includes(slide.imageKey) && !slide.imageKey.startsWith(ownerPrefix(actor))) {
    throw fail('SLIDE_IMAGE_SCOPE', 403);
  }
  const checks = await Promise.all([
    ...slide.regionIds.map(regionId => get(ctx, ctx.homeTables.regions, { regionId })),
    destinationAvailable(ctx, slide),
    ctx.assets.head(slide.imageKey),
  ]);
  const image = checks.pop();
  const destination = checks.pop();
  if (!validImageMetadata(slide.imageKey, image || {})) throw fail('SLIDE_IMAGE_INVALID');
  if (!destination) throw fail('SLIDE_DESTINATION_UNAVAILABLE');
  if (checks.some(region => !region || region.archived || region.deletedAt)) throw fail('SLIDE_REGION_UNAVAILABLE');
  return slide;
}

async function publicFeed(ctx, scope, actionVersion, identity, journey, onlySlideId) {
  const current = await state(ctx);
  const candidates = current.slides.filter(row => row.published && !row.paused && (!onlySlideId || row.id === onlySlideId))
    .map(row => row.published)
    .filter(slide => eligible(slide, scope) && (isOffer(slide.action) ? actionVersion >= 3 : (slide.action.type !== 'announcement' || actionVersion >= 2)))
    .sort(order);
  const slides = await Promise.all(candidates.map(async slide => {
    let action = slide.action;
    let endAt = slide.endAt;
    if (isOffer(action)) {
      const { campaigns: offers } = await campaigns.browse(ctx, {
        campaignId: action.id, offerSource: action.type === 'discount' ? 'merchant' : 'platform',
      }, scope, identity, journey, { summaryOnly: true });
      if (!offers.length) return null;
      action = offers[0].action;
      if (Date.parse(offers[0].endAt) < Date.parse(endAt)) endAt = offers[0].endAt;
    } else if (!await destinationAvailable(ctx, slide)) return null;
    return {
      id: slide.id, title: slide.title, action, ...(isOffer(slide.action) ? { standalone: true } : {}),
      imageUrl: await ctx.assets.url(slide.imageKey), imageVersion: slide.imageKey,
      endAt,
    };
  }));
  return { version: current.version, slides: slides.filter(Boolean) };
}

async function staffRoute(ctx, actor, method, input, readOptions) {
  const permissions = {
    create: allowed(actor, 'promotions.create'),
    edit: allowed(actor, 'promotions.edit'),
    publish: allowed(actor, 'promotions.approve'),
  };
  if (method === 'GET') {
    const [current, options, offers] = await Promise.all([state(ctx), readOptions(), campaigns.headerChoices(ctx.db)]);
    const decorate = async slide => slide && { ...slide, imageUrl: await ctx.assets.url(slide.imageKey) };
    return {
      version: current.version, permissions, options: { ...options, offers: offers.filter(row => row.source !== 'benefit') },
      slides: await Promise.all(current.slides.map(async row => ({
        ...row, draft: await decorate(row.draft), published: await decorate(row.published),
      }))),
    };
  }

  const { action, baseVersion, id, slide: inputSlide } = input;
  if (action === 'upload') {
    if (!permissions.create && !permissions.edit) throw fail('PERMISSION_REQUIRED', 403);
    const { body, extension } = decodeImage(input);
    const imageKey = ownerPrefix(actor) + randomUUID() + '.' + extension;
    await ctx.assets.put(imageKey, body);
    return { imageKey, imageUrl: await ctx.assets.url(imageKey) };
  }

  const current = await state(ctx);
  const before = current.slides.find(row => row.id === id);
  if (current.version !== baseVersion) throw fail('SLIDES_VERSION_CONFLICT', 409);
  if (action !== 'save' && !before) throw fail('SLIDE_UNAVAILABLE', 404);
  const updatedAt = new Date(ctx.now()).toISOString();
  let after;
  switch (action) {
    case 'save': {
      if (!permissions[before ? 'edit' : 'create']) throw fail('PERMISSION_REQUIRED', 403);
      if (!before && current.slides.length >= 20) throw fail('SLIDES_CAPACITY');
      const draft = await validateContent(ctx, actor, { ...inputSlide, id }, before);
      after = { id, published: null, paused: false, ...before, updatedAt, draft };
      break;
    }
    case 'publish': {
      if (!permissions.publish) throw fail('PERMISSION_REQUIRED', 403);
      const publishable = before.draft || (before.paused && before.published);
      if (!publishable) throw fail('SLIDE_DRAFT_REQUIRED', 409);
      const slide = await validateContent(ctx, actor, publishable, before);
      if (Date.parse(slide.endAt) <= ctx.now()) throw fail('SLIDE_SCHEDULE_ENDED');
      after = { ...before, draft: null, published: { ...slide, status: 'published' }, paused: false, updatedAt };
      break;
    }
    case 'pause':
      if (!permissions.publish) throw fail('PERMISSION_REQUIRED', 403);
      if (!before.published || before.paused) throw fail('SLIDE_NOT_ACTIVE', 409);
      after = { ...before, paused: true, updatedAt };
      break;
    case 'archive':
      if (!permissions[before.published ? 'publish' : 'edit']) throw fail('PERMISSION_REQUIRED', 403);
      if (before.published && !before.paused && Date.parse(before.published.endAt) > ctx.now()) {
        throw fail('SLIDE_PAUSE_REQUIRED', 409);
      }
      break;
    default:
      throw fail('INVALID_BODY');
  }

  const next = {
    ...KEY, version: current.version + 1, updatedAt,
    slides: [...current.slides.filter(row => row.id !== id), ...(after ? [after] : [])]
      .sort((a, b) => order(a.draft || a.published, b.draft || b.published)),
  };
  try {
    await ctx.db.send(new TransactWriteCommand({
      TransactItems: [
        ctx.guard(actor),
        { Put: {
          TableName: ctx.table, Item: next,
          ConditionExpression: current.version ? '#version=:version' : 'attribute_not_exists(pk)',
          ...(current.version ? { ExpressionAttributeNames: { '#version': 'version' },
            ExpressionAttributeValues: { ':version': current.version } } : {}),
        } },
        ctx.audit(actor.employeeId, 'HOME_SLIDE_' + action.toUpperCase(), before || null, after || null, randomUUID()),
      ],
    }));
  } catch (error) {
    if (error.name === 'TransactionCanceledException') throw fail('SLIDES_VERSION_CONFLICT', 409);
    throw error;
  }
  return { version: next.version };
}

async function recordEvent(ctx, scope, identity, journey, input) {
  const { slideId, type, sessionId } = input;
  const { slides } = await publicFeed(ctx, scope, 3, identity, journey, slideId);
  if (!slides.length) throw fail('SLIDE_UNAVAILABLE', 404);
  const table = 'wizz-production-OfferJourney';
  const owner = createHash('sha256').update(identity ? 'user:' + identity.sub : 'guest:' + sessionId).digest('hex');
  const day = new Date(scope.now).toISOString().slice(0, 10);
  try {
    await ctx.db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: table, Item: { pk: 'EVENT#' + owner, sk: day + '#' + slideId + '#' + type,
        ttl: Math.floor(scope.now / 1000) + 7 * 86400 }, ConditionExpression: 'attribute_not_exists(pk)' } },
      { Update: { TableName: table, Key: { pk: 'STATS#' + slideId, sk: 'TOTAL' },
        UpdateExpression: 'ADD #metric :one', ExpressionAttributeNames: { '#metric': type === 'view' ? 'views' : 'taps' },
        ExpressionAttributeValues: { ':one': 1 } } },
    ] }));
  } catch (error) {
    if (error.name !== 'TransactionCanceledException' || error.CancellationReasons?.[0]?.Code !== 'ConditionalCheckFailed') throw error;
  }
}

module.exports = { publicFeed, staffRoute, recordEvent };
