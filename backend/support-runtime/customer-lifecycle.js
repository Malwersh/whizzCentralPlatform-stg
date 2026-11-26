'use strict';

const { GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

function customerLifecycleCheck(env, subject) {
    if (typeof subject !== 'string' || !subject || !env.SUPPORT_LIFECYCLE_TABLE) throw Error('CUSTOMER_LIFECYCLE_UNAVAILABLE');
    return { ConditionCheck: {
        TableName: env.SUPPORT_LIFECYCLE_TABLE,
        Key: { pk: 'ACCOUNT_LIFECYCLE#CUSTOMER#' + subject, sk: 'META' },
        ConditionExpression: 'attribute_not_exists(pk)'
    } };
}

function customerSessionChecks(env, session, requireOpen = false) {
    if (session?.userType !== 'customer') return [];
    return [
        customerLifecycleCheck(env, session.customerId),
        { ConditionCheck: {
            TableName: env.CHAT_SESSIONS_TABLE, Key: { sessionId: session.sessionId },
            ConditionExpression: 'customerId=:customer AND userType=:role' + (requireOpen ? ' AND #status<>:closed' : ''),
            ...(requireOpen ? { ExpressionAttributeNames: { '#status': 'status' } } : {}),
            ExpressionAttributeValues: { ':customer': session.customerId, ':role': 'customer', ...(requireOpen ? { ':closed': 'closed' } : {}) }
        } }
    ];
}

async function customerSessionAvailable(db, env, session) {
    if (session?.userType !== 'customer') return true;
    const { TableName, Key } = customerLifecycleCheck(env, session.customerId).ConditionCheck;
    return !(await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
}

function writeWithChecks(db, command, operation, checks) {
    if (!checks.length) return db.send(command);
    return db.send(new TransactWriteCommand({ TransactItems: [...checks, { [operation]: command.input }] }));
}

module.exports = { customerLifecycleCheck, customerSessionChecks, customerSessionAvailable, writeWithChecks };
