'use strict';

const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const esbuild = require(path.join(root, 'backend/wallet-service/node_modules/esbuild'));
const financeSource = path.join(root, 'backend/wallet-service/src');
const merchantRoot = path.resolve(root, '../whizzMerchants-stg/backend');
const merchantSources = {
  'staging-branch-staff': 'functions/auth/branch_staff.js',
  'staging-branch-devices': 'functions/auth/branch_devices.js',
  'staging-branch-pairing': 'functions/auth/device_pairing_verification.js',
};
const aliases = {
  './settlement-runtime': 'merchantSettlementAdminRuntime.ts',
  './merchant-account-index-runtime': 'merchantAccountIndexRuntime.ts',
};

esbuild.build({
  entryPoints: [process.argv[2] ?? path.join(__dirname, 'index.cjs')],
  outfile: process.argv[3],
  bundle: true, platform: 'node', target: 'node22', keepNames: true,
  nodePaths: ['backend/wallet-service/node_modules', 'backend/staff-service/node_modules'].map(name => path.join(root, name)),
  plugins: [{
    name: 'shared-settlement-source',
    setup(build) {
      build.onResolve({filter: /^staging-branch-(staff|devices|pairing)$/}, args => ({
        path: path.join(merchantRoot, merchantSources[args.path]),
      }));
      build.onResolve({filter: /^\.\/(settlement-runtime|merchant-account-index-runtime)$/}, args => ({
        path: path.join(financeSource, aliases[args.path]),
      }));
    },
  }],
}).catch(() => { process.exitCode = 1; });
