'use server';
/**
 * Server actions for the app's own UI. Every action is authenticated,
 * role-checked and validated by `defineAction`. External callers (cron,
 * payment callbacks) use route handlers under src/app/api instead.
 */
import { sessionVersionProof, updateSession } from '@/auth';
import { ALL_ROLES, OWNER, STAFF, SUPPLIER, defineAction } from '@/server/action';
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
  inviteSupplierSchema,
  archiveProductSchema,
  productSchema,
  updateProductSchema,
  reviewDeliverySchema,
  submitDeliverySchema,
  profileSchema,
  requestEmailChangeSchema,
  shopSchema,
  resendInviteSchema,
  userActiveSchema,
  userRoleSchema,
  reverseEntrySchema,
  saleSchema,
  salePriceSchema,
  spoilageSchema,
  updateCustomerSchema,
  updateSupplierSchema,
  subscriptionSchema,
  subscriptionStatusSchema,
  supplierPaymentSchema,
  supplierSchema,
} from '@/lib/validation';

const idOnly = <T extends { id: string }>(row: T) => ({ id: row.id });

// --- counter entries (owner and seller) ----------------------------------
// Attendants record quantities only: prices and dates are enforced in the
// ledger services (see resolvePrice / entryDateFor), not just hidden in the UI.

export const recordSaleAction = defineAction({ schema: saleSchema, roles: STAFF }, ({ db, actor }, input) =>
  ledger.recordSale(db, actor, input).then(idOnly),
);

export const recordDeliveryAction = defineAction(
  { schema: deliverySchema, roles: STAFF },
  ({ db, actor }, input) => ledger.recordDelivery(db, actor, input).then(idOnly),
);

/** The seller (or owner) approves or rejects a delivery a supplier recorded. */
export const reviewDeliveryAction = defineAction(
  { schema: reviewDeliverySchema, roles: STAFF },
  ({ db, actor }, input) => ledger.reviewDelivery(db, actor, input).then((s) => ({ id: s.id, status: s.status })),
);

// --- suppliers' own logins ------------------------------------------------------

export const submitDeliveryAction = defineAction(
  { schema: submitDeliverySchema, roles: SUPPLIER },
  ({ db, actor }, input) => ledger.submitDelivery(db, actor, input).then(idOnly),
);

// --- owner only ---------------------------------------------------------------

export const recordCustomerPaymentAction = defineAction(
  { schema: customerPaymentSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.recordCustomerPayment(db, actor, input).then(idOnly),
);

export const recordSpoilageAction = defineAction(
  { schema: spoilageSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.recordSpoilage(db, actor, input).then(idOnly),
);

export const createCustomerAction = defineAction(
  { schema: customerSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.createCustomer(db, actor, input).then(idOnly),
);

export const billSubscriptionsAction = defineAction(
  { schema: billSubscriptionsSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.billSubscriptions(db, actor, input.date),
);

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

export const updateCustomerAction = defineAction(
  { schema: updateCustomerSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.updateCustomer(db, actor, input).then(idOnly),
);

export const updateSupplierAction = defineAction(
  { schema: updateSupplierSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.updateSupplier(db, actor, input).then(idOnly),
);

export const setSalePriceAction = defineAction({ schema: salePriceSchema, roles: OWNER }, ({ db, actor }, input) =>
  ledger.setSalePrice(db, actor, input.pricePerLitre),
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

// --- products (owner) ------------------------------------------------------------

export const createProductAction = defineAction({ schema: productSchema, roles: OWNER }, ({ db, actor }, input) =>
  ledger.createProduct(db, actor, input).then(idOnly),
);

export const updateProductAction = defineAction(
  { schema: updateProductSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.updateProduct(db, actor, input).then(idOnly),
);

export const archiveProductAction = defineAction(
  { schema: archiveProductSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.setProductArchived(db, actor, input.productId, input.archived).then(idOnly),
);

// --- your account (every role, suppliers included) --------------------------------------------------

export const updateProfileAction = defineAction({ schema: profileSchema, roles: ALL_ROLES }, ({ db, actor }, input) =>
  accounts.updateProfile(db, actor, input.name).then(() => null),
);

export const changePasswordAction = defineAction(
  { schema: changePasswordSchema, roles: ALL_ROLES },
  async ({ db, actor }, input) => {
    const version = await accounts.changePassword(db, actor, input.currentPassword, input.password);
    // Other sessions are now invalid; keep this one alive with a signed proof.
    await updateSession({ sv: version, svProof: sessionVersionProof(actor.id!, version) } as never);
    return null;
  },
);

export const requestEmailChangeAction = defineAction(
  { schema: requestEmailChangeSchema, roles: ALL_ROLES },
  ({ db, actor, ip }, input) => accounts.requestEmailChange(db, actor, input.email, ip).then(() => null),
);

export const confirmEmailChangeAction = defineAction(
  { schema: confirmEmailChangeSchema, roles: ALL_ROLES },
  ({ db, actor }, input) => accounts.confirmEmailChange(db, actor, input.email, input.code).then(() => null),
);

// --- shop & team (owner) -------------------------------------------------------

export const renameShopAction = defineAction({ schema: shopSchema, roles: OWNER }, ({ db, actor }, input) =>
  accounts.renameShop(db, actor, input.name).then(() => null),
);

export const inviteStaffAction = defineAction({ schema: inviteStaffSchema, roles: OWNER }, ({ db, actor }, input) =>
  accounts.inviteStaff(db, actor, input).then(idOnly),
);

export const inviteSupplierAction = defineAction(
  { schema: inviteSupplierSchema, roles: OWNER },
  ({ db, actor }, input) => accounts.inviteSupplier(db, actor, input).then(idOnly),
);

export const setUserActiveAction = defineAction({ schema: userActiveSchema, roles: OWNER }, ({ db, actor }, input) =>
  accounts.setUserActive(db, actor, input.userId, input.active).then(() => null),
);

export const setUserRoleAction = defineAction({ schema: userRoleSchema, roles: OWNER }, ({ db, actor }, input) =>
  accounts.setUserRole(db, actor, input.userId, input.role).then(() => null),
);

export const resendInviteAction = defineAction({ schema: resendInviteSchema, roles: OWNER }, ({ db, actor, ip }, input) =>
  accounts.resendInvite(db, actor, input.userId, ip).then(() => null),
);
