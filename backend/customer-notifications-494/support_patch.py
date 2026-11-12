"""Apply only the durable customer reply outbox to the verified deployed handler."""
def patch(text):
    anchor='        if (receipt) transaction.push({Put: {TableName: receipt.table,'
    assert text.count(anchor)==1
    addition="""        // Customer reply notice commits atomically with message + receipt.
        const customerNotice = require('../utils/customer-inbox').supportReply(sessionRecord, chatMessageItem);
        if (customerNotice) transaction.push({Put: {
            TableName: process.env.WALLET_NOTIFICATIONS_TABLE || 'staging-WalletNotifications',
            Item: customerNotice, ConditionExpression: 'attribute_not_exists(eventId)'
        }});
"""
    return text.replace(anchor,addition+anchor,1)
