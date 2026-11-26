import { walletNotificationTable } from './walletBindings';
import { docClient, TABLES } from './db';
import { createCustomerNotificationStore } from './customerNotificationStore';

const inbox = createCustomerNotificationStore({
  db: docClient,
  notificationsTable: walletNotificationTable,
  readStateTable: TABLES.IDEMPOTENCY_KEYS,
});

export const customerNotifications = inbox.list;
export const readCustomerNotifications = inbox.markRead;
