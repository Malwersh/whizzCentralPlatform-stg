'use strict';

const { TABLE, PRODUCTION_SNAPSHOT_TABLE } = require('./contract');

const SOURCES = Object.freeze({
  offers: 'WaveOffers_staging',
  orders: 'WizzOrders',
  holds: 'staging-Holds',
  drivers: 'WhizzDrivers_staging',
  ratings: 'whizz-order-ratings-staging',
});
const PRODUCTION_SOURCES = Object.freeze({
  offers: 'wizz-production-WaveOffers',
  orders: 'wizz-production-Orders',
  holds: 'wizz-production-Holds',
  drivers: 'wizz-production-Drivers',
  ratings: 'wizz-production-OrderRatings',
});
const STAGING_WORK_QUEUE_ARN = 'arn:aws:sqs:us-east-1:699561669180:staging-driver-performance-refresh';

function performanceBindings(env) {
  const production = env.STAGE === 'production';
  if (!(production || env.STAGE === 'staging') || env.AWS_REGION !== 'us-east-1') {
    throw Error('PERFORMANCE_ENVIRONMENT_NOT_CONFIGURED');
  }
  const sources = production ? PRODUCTION_SOURCES : SOURCES;
  const account = production ? '746727375268' : '699561669180';
  const prefix = production ? 'wizz-production' : 'staging';
  const snapshotTable = production ? PRODUCTION_SNAPSHOT_TABLE : TABLE;
  const workQueueName = prefix + '-driver-performance-refresh';
  const failureQueueName = prefix + '-driver-performance-failures';
  const streams = JSON.parse(env.SOURCE_STREAMS || '{}');
  const names = Object.values(sources);
  if (!streams || Object.keys(streams).length !== names.length || names.some(name => {
    const given = streams[name];
    const start = 'arn:aws:dynamodb:us-east-1:' + account + ':table/' + name + '/stream/';
    return typeof given !== 'string' || !given.startsWith(start) || !/^[A-Za-z0-9_.:-]+$/.test(given.slice(start.length));
  })) throw Error('PROJECTION_SOURCES_UNAVAILABLE');

  if (production) {
    const sqs = 'https://sqs.us-east-1.amazonaws.com/' + account + '/';
    if (env.WORK_QUEUE_URL !== sqs + workQueueName || env.FAILURE_QUEUE_URL !== sqs + failureQueueName ||
        env.DRIVER_PERFORMANCE_TABLE !== snapshotTable) throw Error('PRODUCTION_PROJECTION_BINDING_MISMATCH');
  }
  return {
    sources,
    streams,
    snapshotTable,
    workQueueArn: 'arn:aws:sqs:us-east-1:' + account + ':' + workQueueName,
    collector: prefix + '-driver-performance-collector',
    expectedStreams: names.filter(name => name !== sources.orders).map(name => streams[name]),
  };
}

module.exports = { SOURCES, PRODUCTION_SOURCES, PRODUCTION_SNAPSHOT_TABLE, STAGING_WORK_QUEUE_ARN, performanceBindings };
