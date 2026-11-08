'use server';
/**
 * Server actions for the app's own UI. Every action is authenticated,
 * role-checked and validated by `defineAction`. External callers (cron,
 * payment callbacks) use route handlers under src/app/api instead.
 */
import { sessionVersionProof, updateSession } from '@/auth';
import { ANY_ROLE, OWNER, defineAction } from '@/server/action';
import * as accounts from '@/server/auth/accounts';
import * as ledger from '@/server/ledger';
import {
  billSubscriptionsSchema,
  customerPaymentSchema,
  customerSchema,
  deliverySchema,
  changePasswordSchema,
  confirmEmailChangeSchema,
  expenseSchema,
  inviteStaffSchema,
  profileSchema,
  requestEmailChangeSchema,
  shopSchema,
  userActiveSchema,
  reverseEntrySchema,
  saleSchema,
  spoilageSchema,
  subscriptionSchema,
  subscriptionStatusSchema,
  supplierPaymentSchema,
  supplierSchema,
} from '@/lib/validation';

const idOnly = <T extends { id: string }>(row: T) => ({ id: row.id });

// --- day-to-day entries (owner and attendant) ------------------------------

export const recordSaleAction = defineAction({ schema: saleSchema, roles: ANY_ROLE }, ({ db, actor }, input) =>
  ledger.recordSale(db, actor, input).then(idOnly),
);

export const recordDeliveryAction = defineAction(
  { schema: deliverySchema, roles: ANY_ROLE },
  ({ db, actor }, input) => ledger.recordDelivery(db, actor, input).then(idOnly),
);

export const recordCustomerPaymentAction = defineAction(
  { schema: customerPaymentSchema, roles: ANY_ROLE },
  ({ db, actor }, input) => ledger.recordCustomerPayment(db, actor, input).then(idOnly),
);

export const recordSpoilageAction = defineAction(
  { schema: spoilageSchema, roles: ANY_ROLE },
  ({ db, actor }, input) => ledger.recordSpoilage(db, actor, input).then(idOnly),
);

export const createCustomerAction = defineAction(
  { schema: customerSchema, roles: ANY_ROLE },
  ({ db, actor }, input) => ledger.createCustomer(db, actor, input).then(idOnly),
);

export const billSubscriptionsAction = defineAction(
  { schema: billSubscriptionsSchema, roles: ANY_ROLE },
  ({ db, actor }, input) => ledger.billSubscriptions(db, actor, input.date),
);

// --- money out and corrections (owner only) --------------------------------

export const recordSupplierPaymentAction = defineAction(
  { schema: supplierPaymentSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.recordSupplierPayment(db, actor, input).then(idOnly),
);

export const recordExpenseAction = defineAction(
  { schema: expenseSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.recordExpense(db, actor, input).then(idOnly),
);

export const reverseEntryAction = defineAction(
  { schema: reverseEntrySchema, roles: OWNER },
  ({ db, actor }, input) => ledger.reverseEntry(db, actor, input.entryId, input.reason).then(idOnly),
);

export const createSupplierAction = defineAction(
  { schema: supplierSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.createSupplier(db, actor, input).then(idOnly),
);

export const createSubscriptionAction = defineAction(
  { schema: subscriptionSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.createSubscription(db, actor, input).then(idOnly),
);

export const setSubscriptionStatusAction = defineAction(
  { schema: subscriptionStatusSchema, roles: OWNER },
  ({ db, actor }, input) =>
    ledger.setSubscriptionStatus(db, actor, input.subscriptionId, input.status).then(idOnly),
);

// --- your account (any role) --------------------------------------------------

export const updateProfileAction = defineAction({ schema: profileSchema, roles: ANY_ROLE }, ({ db, actor }, input) =>
  accounts.updateProfile(db, actor, input.name).then(() => null),
);

export const changePasswordAction = defineAction(
  { schema: changePasswordSchema, roles: ANY_ROLE },
  async ({ db, actor }, input) => {
    const version = await accounts.changePassword(db, actor, input.currentPassword, input.password);
    // Other sessions are now invalid; keep this one alive with a signed proof.
    await updateSession({ sv: version, svProof: sessionVersionProof(actor.id!, version) } as never);
    return null;
  },
);

export const requestEmailChangeAction = defineAction(
  { schema: requestEmailChangeSchema, roles: ANY_ROLE },
  ({ db, actor, ip }, input) => accounts.requestEmailChange(db, actor, input.email, ip).then(() => null),
);

export const confirmEmailChangeAction = defineAction(
  { schema: confirmEmailChangeSchema, roles: ANY_ROLE },
  ({ db, actor }, input) => accounts.confirmEmailChange(db, actor, input.email, input.code).then(() => null),
);

// --- shop & team (owner) -------------------------------------------------------

export const renameShopAction = defineAction({ schema: shopSchema, roles: OWNER }, ({ db, actor }, input) =>
  accounts.renameShop(db, actor, input.name).then(() => null),
);

export const inviteStaffAction = defineAction({ schema: inviteStaffSchema, roles: OWNER }, ({ db, actor }, input) =>
  accounts.inviteStaff(db, actor, input).then(idOnly),
);

export const setUserActiveAction = defineAction({ schema: userActiveSchema, roles: OWNER }, ({ db, actor }, input) =>
  accounts.setUserActive(db, actor, input.userId, input.active).then(() => null),
);
