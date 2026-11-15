'use server';
/**
 * Server actions for the app's own UI. Every action is authenticated,
 * role-checked and validated by `defineAction`. External callers (cron,
 * payment callbacks) use route handlers under src/app/api instead.
 */
import { after } from 'next/server';
import { sessionVersionProof, updateSession } from '@/auth';
import type { DB } from '@/db';
import type { Actor } from '@/server/ledger';
import { notifyStockChange } from '@/server/notify/stock-alerts';
import { ALL_ROLES, OWNER, STAFF, SUPPLIER, defineAction } from '@/server/action';
import * as accounts from '@/server/auth/accounts';
import * as ledger from '@/server/ledger';
import * as demo from '@/server/demo/demo';
import * as c2b from '@/server/mpesa/c2b';
import * as mpesa from '@/server/mpesa/payments';
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
  mpesaCustomerPaymentSchema,
  c2bIgnoreSchema,
  c2bToCustomerSchema,
  c2bToSaleSchema,
  connectTillSchema,
  simulateTillPaymentSchema,
  mpesaRequestIdSchema,
  mpesaSaleSchema,
  mpesaSettingsSchema,
  reviewShiftCloseSchema,
  advanceSchema,
  attendanceSchema,
  employeeActiveSchema,
  employeeSchema,
  postPayrollSchema,
  remitStatutorySchema,
  updateEmployeeSchema,
  budgetsSchema,
  paySuppliersSchema,
  shiftCloseSchema,
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
  stockAlertSchema,
  updateCustomerSchema,
  updateSupplierSchema,
  subscriptionSchema,
  subscriptionStatusSchema,
  supplierPaymentSchema,
  supplierSchema,
  demoSwitchRoleSchema,
} from '@/lib/validation';

const idOnly = <T extends { id: string }>(row: T) => ({ id: row.id });

/**
 * WhatsApp the owner about a stock movement once the response has been sent,
 * so the counter never waits on it. A failed message never fails the entry.
 */
function alertStock(db: DB, actor: Actor, entryId: string | null | undefined) {
  if (!entryId) return;
  after(async () => {
    try {
      await notifyStockChange(db, actor.shopId, entryId);
    } catch (error) {
      console.error('[whatsapp] stock update failed', error);
    }
  });
}

// --- counter entries (owner and seller) ----------------------------------
// Attendants record quantities only: prices and dates are enforced in the
// ledger services (see resolvePrice / entryDateFor), not just hidden in the UI.

export const recordSaleAction = defineAction({ schema: saleSchema, roles: STAFF }, async ({ db, actor }, input) => {
  const entry = await ledger.recordSale(db, actor, input);
  alertStock(db, actor, entry.id);
  return idOnly(entry);
});

export const recordDeliveryAction = defineAction({ schema: deliverySchema, roles: STAFF }, async ({ db, actor }, input) => {
  const entry = await ledger.recordDelivery(db, actor, input);
  alertStock(db, actor, entry.id);
  return idOnly(entry);
});

/** The seller (or owner) approves or rejects a delivery a supplier recorded. */
export const reviewDeliveryAction = defineAction(
  { schema: reviewDeliverySchema, roles: STAFF },
  async ({ db, actor }, input) => {
    const s = await ledger.reviewDelivery(db, actor, input);
    alertStock(db, actor, s.ledgerEntryId);
    return { id: s.id, status: s.status };
  },
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
  async ({ db, actor }, input) => {
    const entry = await ledger.recordSpoilage(db, actor, input);
    alertStock(db, actor, entry.id);
    return idOnly(entry);
  },
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
  async ({ db, actor }, input) => {
    const entry = await ledger.reverseEntry(db, actor, input.entryId, input.reason);
    alertStock(db, actor, entry.id);
    return idOnly(entry);
  },
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

export const setStockAlertPhoneAction = defineAction({ schema: stockAlertSchema, roles: OWNER }, ({ db, actor }, input) =>
  ledger.setStockAlertPhone(db, actor, input.phone ?? null),
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

// --- finance (owner) ----------------------------------------------------------------

export const paySuppliersAction = defineAction({ schema: paySuppliersSchema, roles: OWNER }, ({ db, actor }, input) =>
  ledger.paySuppliers(db, actor, input),
);

export const setBudgetsAction = defineAction({ schema: budgetsSchema, roles: OWNER }, ({ db, actor }, input) =>
  ledger.setBudgets(db, actor, input).then(() => null),
);

// --- staff & payroll (owner) --------------------------------------------------------

export const createEmployeeAction = defineAction({ schema: employeeSchema, roles: OWNER }, ({ db, actor }, input) =>
  ledger.createEmployee(db, actor, input).then(idOnly),
);

export const updateEmployeeAction = defineAction(
  { schema: updateEmployeeSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.updateEmployee(db, actor, input).then(idOnly),
);

export const setEmployeeActiveAction = defineAction(
  { schema: employeeActiveSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.setEmployeeActive(db, actor, input.employeeId, input.active).then(() => null),
);

export const setAttendanceAction = defineAction({ schema: attendanceSchema, roles: OWNER }, ({ db, actor }, input) =>
  ledger.setAttendance(db, actor, input).then(() => null),
);

export const giveAdvanceAction = defineAction({ schema: advanceSchema, roles: OWNER }, ({ db, actor }, input) =>
  ledger.giveAdvance(db, actor, input).then(idOnly),
);

export const postPayrollAction = defineAction({ schema: postPayrollSchema, roles: OWNER }, ({ db, actor }, input) =>
  ledger.postPayroll(db, actor, input).then((r) => ({ id: r.id, netCents: r.netCents })),
);

export const remitStatutoryAction = defineAction(
  { schema: remitStatutorySchema, roles: OWNER },
  ({ db, actor }, input) => ledger.remitStatutory(db, actor, input).then(idOnly),
);

// --- M-Pesa (STK Push) ---------------------------------------------------------------

/** Sends the PIN prompt; the sale is recorded only when M-Pesa confirms payment. */
export const startMpesaSaleAction = defineAction({ schema: mpesaSaleSchema, roles: STAFF }, ({ db, actor }, input) =>
  mpesa.startMpesaSale(db, actor, input),
);

export const startMpesaCustomerPaymentAction = defineAction(
  { schema: mpesaCustomerPaymentSchema, roles: OWNER },
  ({ db, actor }, input) => mpesa.startMpesaCustomerPayment(db, actor, input),
);

/** Polled by the counter while the customer answers the prompt. */
export const mpesaStatusAction = defineAction({ schema: mpesaRequestIdSchema, roles: STAFF }, ({ db, actor }, input) =>
  mpesa.refreshMpesaRequest(db, actor, input.requestId),
);

// Till / paybill reconciliation (owner)

export const connectTillAction = defineAction({ schema: connectTillSchema, roles: OWNER }, ({ db, actor }) =>
  c2b.connectTill(db, actor).then(() => null),
);

export const simulateTillPaymentAction = defineAction(
  { schema: simulateTillPaymentSchema, roles: OWNER },
  ({ db, actor }, input) => c2b.simulateTillPayment(db, actor, input).then(() => null),
);

export const matchC2bToCustomerAction = defineAction(
  { schema: c2bToCustomerSchema, roles: OWNER },
  ({ db, actor }, input) => c2b.matchToCustomer(db, actor, input).then(() => null),
);

export const matchC2bToSaleAction = defineAction({ schema: c2bToSaleSchema, roles: OWNER }, ({ db, actor }, input) =>
  c2b.matchToSale(db, actor, input).then(() => null),
);

export const ignoreC2bAction = defineAction({ schema: c2bIgnoreSchema, roles: OWNER }, ({ db, actor }, input) =>
  c2b.ignoreC2b(db, actor, input).then(() => null),
);

export const saveMpesaSettingsAction = defineAction(
  { schema: mpesaSettingsSchema, roles: OWNER },
  ({ db, actor }, input) => mpesa.saveMpesaSettings(db, actor, input).then(() => null),
);

// --- shift close -------------------------------------------------------------------

/** The seller's blind count; the variance is only shown after submitting. */
export const submitShiftCloseAction = defineAction(
  { schema: shiftCloseSchema, roles: STAFF },
  ({ db, actor }, input) =>
    ledger.submitShiftClose(db, actor, input).then((c) => ({
      id: c.id,
      cashVarianceCents: c.countedCashCents - c.expectedCashCents,
      mpesaVarianceCents: c.countedMpesaCents - c.expectedMpesaCents,
      milkVarianceMl: c.countedMilkMl - c.expectedMilkMl,
    })),
);

export const reviewShiftCloseAction = defineAction(
  { schema: reviewShiftCloseSchema, roles: OWNER },
  ({ db, actor }, input) => ledger.reviewShiftClose(db, actor, input).then(idOnly),
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

/** Demo shops only: sign in as the same demo shop's owner, seller or supplier. */
export const demoSwitchRoleAction = defineAction({ schema: demoSwitchRoleSchema, roles: ALL_ROLES }, ({ db, actor }, input) =>
  demo.demoSwitchToken(db, actor, input.role).then((token) => ({ token })),
);
