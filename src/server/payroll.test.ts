/** Staff, attendance, advances and monthly payroll. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, migrateDb, type DB } from '@/db/client';
import { employeeAdvances, ledgerEntries, shops, users } from '@/db/schema';
import { addDays, todayBusinessDate } from '@/lib/dates';
import {
  createEmployee,
  giveAdvance,
  payrollPreview,
  postPayroll,
  setAttendance,
  setEmployeeActive,
  type Actor,
} from './ledger';
import { listEmployees, listPayrollRuns } from './queries';

let db: DB;
let close: () => Promise<void>;
const today = todayBusinessDate();
const month = today.slice(0, 7);

async function makeShop(name: string) {
  const [shop] = await db.insert(shops).values({ name }).returning();
  const [o] = await db
    .insert(users)
    .values({ shopId: shop.id, name: 'Owner', email: `o@${shop.id}.test`, passwordHash: 'x', role: 'owner' })
    .returning();
  const [s] = await db
    .insert(users)
    .values({ shopId: shop.id, name: 'Seller', email: `s@${shop.id}.test`, passwordHash: 'x', role: 'attendant' })
    .returning();
  return {
    shopId: shop.id,
    owner: { id: o.id, role: 'owner', shopId: shop.id } satisfies Actor,
    seller: { id: s.id, role: 'attendant', shopId: shop.id } satisfies Actor,
  };
}

let a: Awaited<ReturnType<typeof makeShop>>;
let b: Awaited<ReturnType<typeof makeShop>>;

beforeAll(async () => {
  ({ db, close } = await createDb({ pgliteDir: 'memory://' }));
  await migrateDb(db);
  a = await makeShop('A');
  b = await makeShop('B');
});

afterAll(() => close());

const wages = (shopId: string) =>
  db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.shopId, shopId), eq(ledgerEntries.expenseCategory, 'wages')));

describe('payroll', () => {
  it('pays day workers for attendance and deducts advances, once per month', async () => {
    const otieno = await createEmployee(db, a.owner, {
      name: 'Otieno',
      payType: 'daily',
      rate: 50_000,
      startDate: `${month}-01`,
    });
    await setAttendance(db, a.owner, { employeeId: otieno.id, present: true });
    await setAttendance(db, a.owner, { employeeId: otieno.id, present: true }); // idempotent
    if (today !== `${month}-01`) await setAttendance(db, a.owner, { employeeId: otieno.id, present: true, date: addDays(today, -1) });
    const days = today === `${month}-01` ? 1 : 2;

    const advance = await giveAdvance(db, a.owner, { employeeId: otieno.id, amount: 20_000, paymentMethod: 'cash' });
    expect(advance.ledgerEntryId).not.toBeNull();
    const [staff] = await listEmployees(db, a.shopId);
    expect(staff).toMatchObject({ daysThisMonth: days, presentToday: true, advancesCents: 20_000 });

    const [line] = await payrollPreview(db, a.shopId, month);
    expect(line).toMatchObject({ grossCents: days * 50_000, advancesCents: 20_000, netCents: days * 50_000 - 20_000 });

    const run = await postPayroll(db, a.owner, { month, paymentMethod: 'mpesa' });
    expect(run.netCents).toBe(days * 50_000 - 20_000);
    // Wages expensed = advance + net pay = gross.
    expect((await wages(a.shopId)).reduce((n, e) => n + e.amountCents, 0)).toBe(days * 50_000);
    const [unsettled] = await db
      .select()
      .from(employeeAdvances)
      .where(and(eq(employeeAdvances.shopId, a.shopId), eq(employeeAdvances.id, advance.id)));
    expect(unsettled.settledInRunId).toBe(run.id);

    await expect(postPayroll(db, a.owner, { month, paymentMethod: 'cash' })).rejects.toThrow('already been paid');
    const [listed] = await listPayrollRuns(db, a.shopId);
    expect(listed.lines).toEqual([expect.objectContaining({ name: 'Otieno', daysWorked: days })]);
  });

  it('carries forward advances bigger than the pay', async () => {
    const amina = await createEmployee(db, b.owner, { name: 'Amina', payType: 'daily', rate: 10_000, startDate: `${month}-01` });
    await setAttendance(db, b.owner, { employeeId: amina.id, present: true });
    await giveAdvance(db, b.owner, { employeeId: amina.id, amount: 25_000, paymentMethod: 'cash' });
    const run = await postPayroll(db, b.owner, { month, paymentMethod: 'cash' });
    expect(run).toMatchObject({ grossCents: 10_000, advancesCents: 10_000, netCents: 0 });
    const [staff] = await listEmployees(db, b.shopId);
    expect(staff.advancesCents).toBe(15_000);
  });

  it('keeps payroll, staff and advances for the owner', async () => {
    await expect(createEmployee(db, a.seller, { name: 'X', payType: 'daily', rate: 1 })).rejects.toThrow('Only the owner');
    const [staff] = await listEmployees(db, a.shopId);
    await expect(setAttendance(db, a.seller, { employeeId: staff.id, present: true })).rejects.toThrow('Only the owner');
    await expect(giveAdvance(db, a.seller, { employeeId: staff.id, amount: 100, paymentMethod: 'cash' })).rejects.toThrow(
      'Only the owner',
    );
    await expect(postPayroll(db, a.seller, { month, paymentMethod: 'cash' })).rejects.toThrow('Only the owner');
  });

  it("won't mark someone who left, or pay a future month", async () => {
    const [staff] = await listEmployees(db, a.shopId);
    await setEmployeeActive(db, a.owner, staff.id, false);
    await expect(setAttendance(db, a.owner, { employeeId: staff.id, present: true })).rejects.toThrow('no longer on the team');
    await expect(postPayroll(db, a.owner, { month: '2999-01', paymentMethod: 'cash' })).rejects.toThrow("hasn't started");
  });
});

describe('tenant isolation', () => {
  it("never touches another shop's staff", async () => {
    const [aStaff] = await listEmployees(db, a.shopId);
    await expect(setAttendance(db, b.owner, { employeeId: aStaff.id, present: true })).rejects.toThrow('Staff member not found');
    await expect(giveAdvance(db, b.owner, { employeeId: aStaff.id, amount: 100, paymentMethod: 'cash' })).rejects.toThrow(
      'Staff member not found',
    );
    await expect(setEmployeeActive(db, b.owner, aStaff.id, true)).rejects.toThrow('Staff member not found');
    expect((await listEmployees(db, b.shopId)).map((e) => e.name)).toEqual(['Amina']);
    expect((await listPayrollRuns(db, b.shopId)).flatMap((r) => r.lines.map((l) => l.name))).toEqual(['Amina']);
  });
});
