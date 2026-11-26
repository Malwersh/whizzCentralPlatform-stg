'use strict';

const { isDeepStrictEqual } = require('node:util');
const { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { financialRecord } = require('../../../backend/account-deletion/customer-cleanup');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { retentionSettings } = require('../../../backend/account-deletion/settings');
const { error } = require('../../../backend/account-deletion/policy');
const { driverExecutionChecks } = require('./customer-execution-scope.cjs');
const { tables } = require('./evidence.cjs');

const auditTable = 'wizz-production-AuditLog';
const ledgerTable = 'wizz-production-LedgerEntries';
const archiveTable = 'wizz-production-AccountDeletionFinancialArchive';
const terminalTransfers = new Set(['COMPLETED','REJECTED','CANCELLED','CANCELED']);
const terminalTopups = new Set(['APPROVED','REJECTED','COMPLETED','CANCELLED','CANCELED']);
const archiveFields = {
  ledger: ['transactionId','walletId','type','category','amount','currency','balanceBefore',
    'balanceAfter','balance','status','createdAt','timestamp','relatedEntityId','orderId','financialOperationId'],
  audit: ['action','transactionId','orderId','branchId','walletId','sourceWalletId','recipientWalletId',
    'transferId','topupId','amount','currency','status','createdAt','timestamp','operationId','financialOperationId'],
  transfer: ['transferId','sourceWalletId','recipientWalletId','amount','currency','status','createdAt','completedAt'],
  topup: ['topupId','walletId','amount','currency','status','createdAt','completedAt','method','approvedById','rejectedById'],
};

function financialArchiveRecord(row, kind, job, now) {
  const data = Object.fromEntries(archiveFields[kind].filter(field=>row[field]!==undefined).map(field=>[field,row[field]]));
  if (kind==='audit' && !data.createdAt && !data.timestamp) {
    const timestamp=row.sk.split('#')[0];
    if (Number.isFinite(Date.parse(timestamp))) data.timestamp=timestamp;
  }
  if (Object.values(data).some(value=>value!==null && typeof value!=='string' && !Number.isSafeInteger(value)) ||
      !data.createdAt && !data.timestamp || data.currency != null && data.currency !== 'IQD' ||
      (kind!=='audit' || data.amount!==undefined) && !Number.isSafeInteger(data.amount)) throw error('FINANCIAL_RECORD_INVALID');
  if (kind==='ledger') {
    const knownLegacyHold = ['HOLD_CREATED','HOLD_CAPTURED','HOLD_RELEASED','HOLD_PARTIAL_RELEASE','HOLD_LOCKED'].includes(row.type) &&
      row.relatedEntityType==='HOLD' && typeof row.relatedEntityId==='string' && Number.isSafeInteger(data.balance);
    if ((data.balanceBefore!==undefined || data.balanceAfter!==undefined || !knownLegacyHold) &&
        ![data.balanceBefore,data.balanceAfter].every(Number.isSafeInteger)) throw error('FINANCIAL_RECORD_INVALID');
    if (knownLegacyHold && typeof row.metadata?.orderId==='string' &&
        /^[A-Za-z0-9_.:-]{1,150}$/.test(row.metadata.orderId)) data.orderId=row.metadata.orderId;
    if ([2,3,4,5].includes(row.financialSchemaVersion ?? row.metadata?.financialSchemaVersion)) {
      data.financialSchemaVersion = row.financialSchemaVersion ?? row.metadata.financialSchemaVersion;
      const orderId = row.orderId ?? row.metadata?.orderId;
      if (typeof orderId === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(orderId)) data.orderId=orderId;
    }
  }
  if (kind==='audit') {
    const refs=row.references ?? {};
    for (const field of ['walletId','sourceWalletId','recipientWalletId','transferId','topupId','orderId','branchId','operationId']) {
      if (typeof refs[field]==='string' && /^[A-Za-z0-9_.:#-]{1,180}$/.test(refs[field])) {
        if (data[field]!==undefined && data[field]!==refs[field]) throw error('FINANCIAL_RECORD_INVALID');
        data[field]=refs[field];
      }
    }
    if (typeof data.action!=='string' || !/^[A-Z0-9_]{1,150}$/.test(data.action)) throw error('FINANCIAL_RECORD_INVALID');
  }
  const record = financialRecord(data, kind, job, now);
  if (data.financialSchemaVersion !== undefined) record.data.financialSchemaVersion=data.financialSchemaVersion;
  return record;
}

async function archiveDriverWalletRecords({ db, request, job, clock = Date.now, maxPages = 100 }) {
  driverExecutionChecks(request, job, clock());
  const walletId = 'WALLET#DRIVER#' + request.subjectId;
  if (request.policyVersion !== job.policyVersion ||
      !Array.isArray(job.walletIds) || job.walletIds.some(id=>id!==walletId)) throw error('INVALID_CLEANUP_SCOPE');
  const policy = await retentionSettings({db,table:tables.staff,environment:'production'})('DRIVER',job.policyVersion);
  if (policy.financialRetentionYears !== job.financialYears) throw error('RETENTION_POLICY_INVALID');
  const records = [];
  const now = new Date(clock()).toISOString();
  const auditWalletFields = ['walletId','sourceWalletId','recipientWalletId'];
  const auditDriverActor = row => row.actorId===request.subjectId &&
    (row.actorIdentityEvidence==='VERIFIED_DRIVER_AT_ACTION' || row.actorType==='DRIVER');
  const auditOwned = row => auditDriverActor(row) || row.driverId===request.subjectId ||
    auditWalletFields.some(field=>row[field]===walletId || row.references?.[field]===walletId);
  const sources = [
    { table:ledgerTable,kind:'ledger', key:'walletId', command:QueryCommand,
      expression:{ KeyConditionExpression:'walletId=:wallet',ExpressionAttributeValues:{':wallet':walletId} },
      owns:row=>row.walletId===walletId },
    { table:tables.topups,kind:'topup', key:'topupId', command:ScanCommand, terminal:terminalTopups,
      expression:{ FilterExpression:'walletId=:wallet OR driverId=:driver',
        ExpressionAttributeValues:{':wallet':walletId,':driver':request.subjectId} },
      owns:row=>row.walletId===walletId && row.sk==='META' && row.driverId===request.subjectId },
    { table:tables.transfers,kind:'transfer', key:'idempotencyKey', command:ScanCommand, terminal:terminalTransfers,
      expression:{ FilterExpression:'begins_with(idempotencyKey,:prefix) AND (sourceWalletId=:wallet OR recipientWalletId=:wallet)',
        ExpressionAttributeValues:{':prefix':'TRANSFER#',':wallet':walletId} },
      owns:row=>row.sk==='META' && typeof row.transferId==='string' && row.transferId.length>0 &&
        row.idempotencyKey==='TRANSFER#'+row.transferId &&
        [row.sourceWalletId,row.recipientWalletId].every(id=>typeof id==='string' && id.startsWith('WALLET#')) &&
        row.sourceWalletId!==row.recipientWalletId && [row.sourceWalletId,row.recipientWalletId].includes(walletId) },
    { table:auditTable,kind:'audit',key:'datePartition',command:ScanCommand,
      expression:{
        FilterExpression:'(actorId=:driver AND (actorType=:driverRole OR actorIdentityEvidence=:driverProof)) OR driverId=:driver OR walletId=:wallet OR sourceWalletId=:wallet OR recipientWalletId=:wallet OR #references.walletId=:wallet OR #references.sourceWalletId=:wallet OR #references.recipientWalletId=:wallet',
        ExpressionAttributeNames:{'#references':'references'},
        ExpressionAttributeValues:{':driver':request.subjectId,':driverRole':'DRIVER',
          ':driverProof':'VERIFIED_DRIVER_AT_ACTION',':wallet':walletId},
      },
      owns:row=>auditOwned(row) && /^date#[0-9]{8}$/.test(row.datePartition) &&
        (!auditDriverActor(row) || !row.actorSnapshot?.driverId || row.actorSnapshot.driverId===request.subjectId) },
  ];
  for (const source of sources) {
    let cursor, pages=0;
    do {
      const response = await db.send(new source.command({
        TableName:source.table, ConsistentRead:true, Limit:250, ExclusiveStartKey:cursor, ...source.expression,
      }));
      for (const row of response.Items ?? []) {
        if (!source.owns(row) || typeof row[source.key] !== 'string' || !row[source.key] ||
            typeof row.sk !== 'string' || !row.sk) {
          throw error('INVALID_CLEANUP_SCOPE');
        }
        if (row.legalHold || row.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
        if (source.terminal && !source.terminal.has(row.status)) throw error('SETTLEMENT_REQUIRED');
        const key = { [source.key]:row[source.key], sk:row.sk };
        const archiveKey = { pk:'REQUEST#'+request.requestId, sk:source.kind.toUpperCase()+'#'+JSON.stringify(key) };
        records.push({row,key,archiveKey,source,archive:{...archiveKey,
          ...financialArchiveRecord(row,source.kind,job,now),sourceTable:source.table,sourceKey:key}});
      }
      cursor=response.LastEvaluatedKey;
      if (++pages>=maxPages && cursor) throw error('INVENTORY_INCOMPLETE');
    } while (cursor);
  }

  for (const {row,key,archiveKey,source,archive} of records) {
    const ownedAudit = source.kind==='audit' && auditDriverActor(row);
    const removeActorName = ownedAudit && row.actorSnapshot?.driverId===request.subjectId &&
      typeof row.actorSnapshot.name==='string';
    const removeReason = ownedAudit && typeof row.reason==='string';
    const previous = (await db.send(new GetCommand({
      TableName:archiveTable,Key:archiveKey,ConsistentRead:true,
    }))).Item;
    if (previous) {
      if (!isDeepStrictEqual(previous,{...archive,archivedAt:previous.archivedAt})) throw error('ARCHIVE_CONFLICT');
      if (!removeActorName && !removeReason) continue;
    }
    const sourceCondition=exact(row,['actorId','actorType','actorIdentityEvidence','actorSnapshot','reason']);
    const auditRemoval=[];
    const names={};
    if (removeActorName) {
      auditRemoval.push('#actor.#name');
      Object.assign(names,{'#actor':'actorSnapshot','#name':'name'});
    }
    if (removeReason) {
      auditRemoval.push('#reason');
      names['#reason']='reason';
    }
    const sourceOperation=auditRemoval.length ? {Update:{
      TableName:source.table,Key:key,...sourceCondition,
      UpdateExpression:'REMOVE '+auditRemoval.join(', '),
      ExpressionAttributeNames:{...sourceCondition.ExpressionAttributeNames,...names},
    }} : {ConditionCheck:{TableName:source.table,Key:key,...sourceCondition}};
    await db.send(new TransactWriteCommand({ TransactItems:[
      ...driverExecutionChecks(request,job,clock()),
      { ConditionCheck:{TableName:tables.staff,
        Key:{pk:'OPERATIONAL_SETTINGS#ACCOUNT_DELETION',sk:'VERSION#'+job.policyVersion},
        ConditionExpression:'policyVersion=:policy AND #values.financialRetentionYears=:years AND attribute_exists(approvedAt) AND attribute_exists(approvedBy)',
        ExpressionAttributeNames:{'#values':'values'},
        ExpressionAttributeValues:{':policy':job.policyVersion,':years':job.financialYears},
      } },
      sourceOperation,
      previous ? {ConditionCheck:{TableName:archiveTable,Key:archiveKey,...exact(previous)}} :
        {Put:{TableName:archiveTable,Item:archive,ConditionExpression:'attribute_not_exists(pk)'}},
    ] }));
  }
}

module.exports = { archiveDriverWalletRecords };
