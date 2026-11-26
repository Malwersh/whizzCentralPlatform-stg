'use strict';
const {GetCommand} = require('@aws-sdk/lib-dynamodb');
// Order context is read-only. A profile/order ID supplied by the client never
// establishes ownership; only the verified customer subject is authoritative.
async function customerOwnsOrder(db, env, subject, orderId) {
    if (!env.SUPPORT_CUSTOMER_ORDERS_TABLE || !env.SUPPORT_CUSTOMER_PROFILES_TABLE ||
        typeof subject !== 'string' || !subject || typeof orderId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(orderId)) return false;
    const order = (await db.send(new GetCommand({TableName: env.SUPPORT_CUSTOMER_ORDERS_TABLE,
        Key: {PK: 'ORDER#' + orderId, SK: 'META'}, ConsistentRead: true}))).Item;
    if (!order || order.orderId !== orderId || order.isGuestOrder === true || order.isDeleted === true ||
        order.deletedAt != null || order.deletionRequestId != null) return false;
    if (order.userSub != null ? order.userSub !== subject : !(order.userId === subject || order.customerId === subject)) return false;
    if (typeof order.userId !== 'string' || !order.userId) return false;
    const profile = (await db.send(new GetCommand({TableName: env.SUPPORT_CUSTOMER_PROFILES_TABLE,
        Key: {userId: order.userId}, ConsistentRead: true}))).Item;
    return !!profile && profile.userId === order.userId && profile.isActive !== false &&
        profile.deletionRequestId == null && (profile.cognitoSub == null || profile.cognitoSub === subject);
}
module.exports = {customerOwnsOrder};
