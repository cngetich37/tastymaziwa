/**
 * Realistic sample trading for a demo shop: six weeks of a busy maziwa duka,
 * so that every page has something to show and something to do.
 *
 * What a visitor finds (and can try):
 * - Counter: today's sales so far, an open shift to close, and yesterday's
 *   close (short on cash and milk) waiting for the owner to sign off.
 * - Purchasing: three suppliers with payables. Kiprono has his own login, and
 *   today's delivery from him is waiting for the seller to approve. A rejected
 *   delivery and its re-entry are in the approvals history.
 * - Sales: customers on credit in every ageing bucket (current, 8–30 days,
 *   30+ days), one near their credit limit, a settled one, two active
 *   subscriptions and a paused one.
 * - Inventory: mala, yoghurt and ghee bought weekly, with sales and a write-off.
 * - Finance: rent, power, transport and packaging, budgets (one over), a
 *   reversed mistake in the ledger.
 * - People: three staff with attendance, one formally employed (statutory
 *   deductions), an advance, and last month's payroll still to run.
 *
 * Rows are inserted in bulk with `created_at` = when they happened, so the
 * shift-close windows (which use `created_at`) line up with the history.
 * Deterministic for a given `now`, so tests can rely on the shape.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import {
  attendance,
  auditLog,
  customers,
  deliverySubmissions,
  employeeAdvances,
  employees,
  expenseBudgets,
  ledgerEntries,
  products,
  shiftCloses,
  shops,
  subscriptions,
  suppliers,
  users,
  type NewLedgerEntry,
} from '@/db/schema';
import { expectedTakings } from '@/lib/calc/close';
import { addDays, todayBusinessDate, type BusinessDate } from '@/lib/dates';
import { lineTotalCents } from '@/lib/money';

/** Days of history, today included. Covers all of last month for payroll and reports. */
export const DEMO_HISTORY_DAYS = 45;

export const DEMO_SALE_PRICE_CENTS = 7000;

export interface DemoPopulateOptions {
  shopId: string;
  ownerId: string;
  /** Logins created for the other two roles (no passwords: demo or email-code sign-in). */
  emails: { seller: string; supplier: string };
  now?: Date;
}

export interface DemoPopulateResult {
  sellerId: string;
  supplierUserId: string;
  entries: number;
}

const L = (litres: number) => Math.round(litres * 1000);
const KES = (shillings: number) => Math.round(shillings * 100);
/** Whole shillings, rounded down to the nearest 100 (how people actually pay). */
const roundDown100 = (cents: number) => Math.floor(cents / 10_000) * 10_000;

export async function populateDemoShop(tx: Tx, opts: DemoPopulateOptions): Promise<DemoPopulateResult> {
  const now = opts.now ?? new Date();
  const today = todayBusinessDate(now);
  const { shopId, ownerId } = opts;

  // Deterministic pseudo-random numbers.
  let seed = 20_251_115;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  // --- time: Nairobi is UTC+3 all year ---------------------------------------------
  const midnight = (date: BusinessDate) => new Date(`${date}T00:00:00+03:00`).getTime();
  const elapsedToday = Math.max(0, now.getTime() - midnight(today) - 60_000);
  /** `hour` (e.g. 6.5 = 06:30) on `date`. Today's day is squeezed into the hours so far. */
  const at = (date: BusinessDate, hour: number) =>
    date === today
      ? new Date(midnight(today) + (elapsedToday * Math.min(hour, 21)) / 21)
      : new Date(midnight(date) + hour * 3_600_000);
  const hoursToday = elapsedToday / 3_600_000;
  /** How much of a normal day's walk-in trade has happened by now. */
  const todayShare = Math.min(1, Math.max(0.3, (hoursToday - 5) / 15));

  // --- the shop and its people ------------------------------------------------------
  await tx.update(shops).set({ salePricePerLitreCents: DEMO_SALE_PRICE_CENTS }).where(eq(shops.id, shopId));

  const supplier = async (name: string, phone: string, price: number | null) =>
    (await tx.insert(suppliers).values({ shopId, name, phone, defaultPricePerLitreCents: price }).returning())[0];
  const kiprono = await supplier('Kiprono Dairy Farm', '+254700000201', KES(52));
  const wanjiru = await supplier('Wanjiru the milkman', '+254700000202', KES(50));
  // Mostly packaged goods, but has a milk price too, so the owner's setup checklist is complete.
  const depot = await supplier('Maziwa Wholesalers', '+254700000203', KES(55));

  const [seller] = await tx
    .insert(users)
    .values({ shopId, name: 'Brian Otieno', email: opts.emails.seller, emailVerifiedAt: now, role: 'attendant' })
    .returning({ id: users.id });
  const [supplierUser] = await tx
    .insert(users)
    .values({
      shopId,
      name: 'Joseph Kiprono',
      email: opts.emails.supplier,
      emailVerifiedAt: now,
      role: 'supplier',
      supplierId: kiprono.id,
    })
    .returning({ id: users.id });

  const customer = async (name: string, extra: { phone?: string; address?: string; limit?: number } = {}) =>
    (
      await tx
        .insert(customers)
        .values({
          shopId,
          name,
          phone: extra.phone ?? null,
          address: extra.address ?? null,
          creditLimitCents: extra.limit ?? null,
        })
        .returning()
    )[0];
  const jane = await customer('Jane Achieng', { phone: '+254700000101', address: 'Block C, Hse 4', limit: KES(2000) });
  const peter = await customer('Peter Kamau', { phone: '+254700000102' });
  const otieno = await customer('Otieno Juma', { phone: '+254700000103', limit: KES(1500) });
  const tumaini = await customer('Tumaini Café', { phone: '+254700000104', address: 'Main stage', limit: KES(10_000) });
  const mama = await customer('Mama Wanjiku', { address: 'Gate 2' });
  const watoto = await customer('Watoto Wema Daycare', { phone: '+254700000105' });
  const grace = await customer('Grace Muthoni', { phone: '+254700000106' });

  const product = async (name: string, sale: number, cost: number, reorder: number) =>
    (
      await tx
        .insert(products)
        .values({ shopId, name, unit: 'piece', salePriceCents: KES(sale), costPriceCents: KES(cost), reorderLevel: L(reorder) })
        .returning()
    )[0];
  const mala = await product('Mala 500 ml', 70, 50, 10);
  const yoghurt = await product('Yoghurt 500 ml', 60, 42, 12);
  const ghee = await product('Ghee 250 g', 350, 280, 3);

  const subscription = async (customerId: string, litres: number, price: number, daysAgo: number, status: 'active' | 'paused') =>
    (
      await tx
        .insert(subscriptions)
        .values({ shopId, customerId, dailyMl: L(litres), pricePerLitreCents: KES(price), startDate: addDays(today, -daysAgo), status })
        .returning()
    )[0];
  const subs = [
    { sub: await subscription(mama.id, 2, 65, 44, 'active'), from: 44, until: 0 },
    { sub: await subscription(tumaini.id, 10, 62, 30, 'active'), from: 30, until: 0 },
    // Paused three weeks ago ("closed for half-term").
    { sub: await subscription(watoto.id, 5, 63, 44, 'paused'), from: 44, until: 21 },
  ];

  const employee = async (values: Omit<typeof employees.$inferInsert, 'shopId'>) =>
    (await tx.insert(employees).values({ shopId, ...values }).returning())[0];
  const brian = await employee({ name: 'Brian Otieno', phone: '+254700000301', payType: 'daily', rateCents: KES(700), startDate: addDays(today, -400) });
  const faith = await employee({
    name: 'Faith Njeri',
    phone: '+254700000302',
    payType: 'monthly',
    rateCents: KES(18_000),
    startDate: addDays(today, -700),
    statutory: true,
    kraPin: 'A012345678Z',
    nssfNumber: '2034567',
    shaNumber: 'SHA-0012345',
  });
  const kevin = await employee({ name: 'Kevin Mutua', payType: 'daily', rateCents: KES(450), startDate: addDays(today, -90) });

  await tx.insert(expenseBudgets).values(
    (
      [
        ['transport', 6500],
        ['packaging', 1500],
        ['electricity', 2500],
        ['rent', 15_000],
        // Over budget this month: the fridge repair.
        ['equipment', 1000],
        ['other', 600],
      ] as const
    ).map(([category, kes]) => ({ shopId, category, monthlyCents: KES(kes) })),
  );

  // --- six weeks of trading ---------------------------------------------------------
  const rows: NewLedgerEntry[] = [];
  const submissions: (typeof deliverySubmissions.$inferInsert)[] = [];
  const advances: (typeof employeeAdvances.$inferInsert)[] = [];
  const closes: (typeof shiftCloses.$inferInsert)[] = [];
  const presence: (typeof attendance.$inferInsert)[] = [];

  let milkMl = 0;
  const productStock = new Map<string, number>([[mala.id, 0], [yoghurt.id, 0], [ghee.id, 0]]);
  const payable = new Map<string, number>();
  const recentDeliveries = new Map<string, { date: BusinessDate; cents: number }[]>();
  const owed = new Map<string, number>();
  const billedOn = new Map<string, { date: BusinessDate; cents: number }[]>();
  let lastCloseAt: Date | null = null;

  const add = (date: BusinessDate, hour: number, by: string | null, entry: Omit<NewLedgerEntry, 'shopId' | 'businessDate'>) => {
    const occurredAt = entry.occurredAt ?? at(date, hour);
    const row: NewLedgerEntry = { shopId, businessDate: date, createdBy: by, createdAt: occurredAt, ...entry, occurredAt };
    rows.push(row);
    return row;
  };

  const delivered = (date: BusinessDate, supplierId: string, cents: number) => {
    payable.set(supplierId, (payable.get(supplierId) ?? 0) + cents);
    recentDeliveries.set(supplierId, [...(recentDeliveries.get(supplierId) ?? []), { date, cents }]);
  };
  /** What a supplier is owed, less deliveries in the last `keepDays` (paid next time). */
  const settleable = (supplierId: string, date: BusinessDate, keepDays: number) => {
    const recent = (recentDeliveries.get(supplierId) ?? [])
      .filter((d) => d.date > addDays(date, -keepDays))
      .reduce((n, d) => n + d.cents, 0);
    return roundDown100((payable.get(supplierId) ?? 0) - recent);
  };
  const paySupplier = (date: BusinessDate, hour: number, supplierId: string, cents: number, method: 'cash' | 'mpesa') => {
    if (cents <= 0) return;
    payable.set(supplierId, (payable.get(supplierId) ?? 0) - cents);
    add(date, hour, ownerId, { kind: 'supplier_payment', paymentMethod: method, amountCents: cents, supplierId });
  };

  const creditSale = (date: BusinessDate, hour: number, customerId: string, litres: number, extra: Partial<NewLedgerEntry> = {}) => {
    const volumeMl = L(litres);
    const price = extra.unitPriceCents ?? DEMO_SALE_PRICE_CENTS;
    const amountCents = lineTotalCents(volumeMl, price);
    owed.set(customerId, (owed.get(customerId) ?? 0) + amountCents);
    billedOn.set(customerId, [...(billedOn.get(customerId) ?? []), { date, cents: amountCents }]);
    add(date, hour, seller.id, {
      kind: 'sale',
      paymentMethod: 'credit',
      customerId,
      volumeMl,
      unitPriceCents: price,
      amountCents,
      dueDate: addDays(date, 7),
      ...extra,
    });
    return volumeMl;
  };
  const customerPays = (date: BusinessDate, hour: number, customerId: string, cents: number, method: 'cash' | 'mpesa') => {
    if (cents <= 0) return;
    owed.set(customerId, (owed.get(customerId) ?? 0) - cents);
    add(date, hour, ownerId, { kind: 'customer_payment', paymentMethod: method, customerId, amountCents: cents });
  };

  for (let d = DEMO_HISTORY_DAYS - 1; d >= 0; d--) {
    const date = addDays(today, -d);
    const isToday = d === 0;
    const dayStart = rows.length;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const dom = Number(date.slice(8, 10));
    let milkIn = 0;
    let milkOut = 0;

    // Morning deliveries.
    const wanjiruMl = L(between(45, 58));
    const wanjiruCents = lineTotalCents(wanjiruMl, KES(50));
    add(date, 6, seller.id, { kind: 'delivery', supplierId: wanjiru.id, volumeMl: wanjiruMl, unitPriceCents: KES(50), amountCents: wanjiruCents });
    delivered(date, wanjiru.id, wanjiruCents);
    milkIn += wanjiruMl;

    const kipronoMl = L(between(38, 48));
    if (isToday) {
      // Waiting for the seller: "Waiting for approval" on the Today page.
      submissions.push({ shopId, supplierId: kiprono.id, businessDate: date, volumeMl: kipronoMl, submittedBy: supplierUser.id, submittedAt: at(date, 6.5) });
    } else {
      const kipronoCents = lineTotalCents(kipronoMl, KES(52));
      if (d <= 10) {
        // Since Kiprono got his own login, he records and the seller approves.
        if (d === 4) {
          submissions.push({
            shopId, supplierId: kiprono.id, businessDate: date, volumeMl: kipronoMl + L(2), submittedBy: supplierUser.id,
            submittedAt: at(date, 6.4), status: 'rejected', reviewedBy: seller.id, reviewedAt: at(date, 6.6),
            reviewNote: 'Counted 2 L less in the cans. Please record it again.',
          });
        }
        const submissionId = randomUUID();
        const entry = add(date, 6.75, seller.id, {
          id: randomUUID(), kind: 'delivery', supplierId: kiprono.id, volumeMl: kipronoMl, unitPriceCents: KES(52),
          amountCents: kipronoCents, occurredAt: at(date, 6.5), idempotencyKey: `delivery-sub:${submissionId}`,
        });
        entry.createdAt = at(date, 6.75);
        submissions.push({
          id: submissionId, shopId, supplierId: kiprono.id, businessDate: date, volumeMl: kipronoMl, submittedBy: supplierUser.id,
          submittedAt: at(date, 6.5), status: 'approved', reviewedBy: seller.id, reviewedAt: at(date, 6.75), ledgerEntryId: entry.id,
        });
      } else {
        add(date, 6.5, seller.id, { kind: 'delivery', supplierId: kiprono.id, volumeMl: kipronoMl, unitPriceCents: KES(52), amountCents: kipronoCents });
      }
      delivered(date, kiprono.id, kipronoCents);
      milkIn += kipronoMl;
    }

    // Fare to fetch the milk, every day.
    add(date, 5.9, seller.id, { kind: 'expense', expenseCategory: 'transport', paymentMethod: 'cash', amountCents: KES(200), note: 'Boda to the farm' });

    // Subscriptions, billed by the 06:00 job.
    for (const { sub, from, until } of subs) {
      if (d > from || d < until) continue;
      milkOut += creditSale(date, 6, sub.customerId, sub.dailyMl / 1000, {
        unitPriceCents: sub.pricePerLitreCents,
        subscriptionId: sub.id,
        note: 'Subscription delivery',
        idempotencyKey: `sub:${sub.id}:${date}`,
        createdBy: null,
      });
    }

    // Weekly stock from the wholesaler, paid on delivery.
    if (d % 7 === 3) {
      let total = 0;
      for (const [p, qty] of [[mala, 48], [yoghurt, 36], [ghee, 12]] as const) {
        const cents = lineTotalCents(L(qty), p.costPriceCents!);
        add(date, 10, ownerId, { kind: 'delivery', supplierId: depot.id, productId: p.id, volumeMl: L(qty), unitPriceCents: p.costPriceCents, amountCents: cents });
        productStock.set(p.id, productStock.get(p.id)! + L(qty));
        delivered(date, depot.id, cents);
        total += cents;
      }
      paySupplier(date, 10.1, depot.id, total, 'mpesa');
    }

    // Regulars on credit (deni).
    if (d <= 40 && d % 2 === 0) milkOut += creditSale(date, 8, jane.id, 2);
    if (d >= 12 && d <= 26 && d % 3 === 0) milkOut += creditSale(date, 18, peter.id, 3);
    if ([42, 40, 38, 36].includes(d)) milkOut += creditSale(date, 17, otieno.id, 4);
    if (d % 9 === 0 && !isToday) milkOut += creditSale(date, 17.5, grace.id, 1.5);

    // Spoilage.
    let spoiltMl = 0;
    if (d === 12) spoiltMl = L(6);
    else if (d % 5 === 2) spoiltMl = L(between(1, 3));
    if (spoiltMl > 0) {
      add(date, 20, ownerId, {
        kind: 'spoilage', volumeMl: spoiltMl, expenseCategory: d === 12 ? 'power_outage' : 'sour',
        note: d === 12 ? 'Power cut overnight, fridge was off' : null,
      });
    }
    if (d === 9 && productStock.get(yoghurt.id)! >= L(2)) {
      add(date, 20, ownerId, { kind: 'spoilage', productId: yoghurt.id, volumeMl: L(2), expenseCategory: 'other', note: 'Past sell-by date' });
      productStock.set(yoghurt.id, productStock.get(yoghurt.id)! - L(2));
    }

    // Walk-in milk sales, cash and M-Pesa, through the day. Past days sell
    // down to a few litres; today has sold its share so far.
    const available = milkMl + milkIn - milkOut - spoiltMl;
    const walkInMl = isToday
      ? Math.min(Math.round((L(between(70, 80)) * todayShare) / 500) * 500, Math.max(0, available - L(3)))
      : Math.max(0, available - L(between(4, 9)));
    let left = walkInMl;
    const sales: { ml: number; hour: number; method: 'cash' | 'mpesa' }[] = [];
    while (left > 0) {
      const ml = Math.min(left, between(2, 20) * 500);
      sales.push({ ml, hour: 7 + rand() * 13, method: rand() < 0.6 ? 'cash' : 'mpesa' });
      left -= ml;
    }
    for (const s of sales.sort((a, b) => a.hour - b.hour)) {
      add(date, s.hour, seller.id, {
        kind: 'sale', paymentMethod: s.method, volumeMl: s.ml, unitPriceCents: DEMO_SALE_PRICE_CENTS,
        amountCents: lineTotalCents(s.ml, DEMO_SALE_PRICE_CENTS),
      });
    }
    milkOut += walkInMl;

    // Mala, yoghurt and ghee.
    for (const [p, lo, hi] of [[mala, 3, 8], [yoghurt, 2, 6], [ghee, 0, 2]] as const) {
      const wanted = L(Math.round(between(lo, hi) * (isToday ? todayShare : 1)));
      const qty = Math.min(wanted, productStock.get(p.id)!);
      if (qty <= 0) continue;
      productStock.set(p.id, productStock.get(p.id)! - qty);
      add(date, 9 + rand() * 10, seller.id, {
        kind: 'sale', paymentMethod: rand() < 0.6 ? 'cash' : 'mpesa', productId: p.id, volumeMl: qty,
        unitPriceCents: p.salePriceCents, amountCents: lineTotalCents(qty, p.salePriceCents!),
      });
    }

    // A typo the owner corrected: 50 L instead of 5 L. Reversals keep the history.
    if (d === 3) {
      const mistake = add(date, 11, seller.id, {
        id: randomUUID(), kind: 'sale', paymentMethod: 'cash', volumeMl: L(50), unitPriceCents: DEMO_SALE_PRICE_CENTS,
        amountCents: lineTotalCents(L(50), DEMO_SALE_PRICE_CENTS),
      });
      add(date, 11.25, ownerId, {
        kind: 'sale', paymentMethod: 'cash', volumeMl: -L(50), unitPriceCents: DEMO_SALE_PRICE_CENTS,
        amountCents: -lineTotalCents(L(50), DEMO_SALE_PRICE_CENTS), reversesId: mistake.id,
        note: 'Reversal: Typed 50 L instead of 5 L',
      });
    }

    // Running costs.
    if (weekday === 1) add(date, 9, ownerId, { kind: 'expense', expenseCategory: 'packaging', paymentMethod: 'cash', amountCents: KES(350), note: 'Milk bags' });
    if (weekday === 5) add(date, 12, ownerId, { kind: 'expense', expenseCategory: 'other', paymentMethod: 'cash', amountCents: KES(100), note: 'Airtime' });
    if (dom === 1) add(date, 9.5, ownerId, { kind: 'expense', expenseCategory: 'rent', paymentMethod: 'mpesa', amountCents: KES(15_000), note: 'Shop rent' });
    if (dom === 1 || dom === 15) add(date, 9.6, ownerId, { kind: 'expense', expenseCategory: 'electricity', paymentMethod: 'mpesa', amountCents: KES(1000), note: 'KPLC tokens' });
    if (d === 6) add(date, 14, ownerId, { kind: 'expense', expenseCategory: 'equipment', paymentMethod: 'cash', amountCents: KES(2500), note: 'Fridge compressor repair' });

    // An advance to Kevin, deducted at the next payroll.
    if (d === 5) {
      const entry = add(date, 13, ownerId, {
        id: randomUUID(), kind: 'expense', expenseCategory: 'wages', paymentMethod: 'cash', amountCents: KES(1000),
        note: 'Advance: Kevin Mutua (school fees)',
      });
      advances.push({ shopId, employeeId: kevin.id, businessDate: date, amountCents: KES(1000), note: 'School fees', ledgerEntryId: entry.id, createdBy: ownerId, createdAt: at(date, 13) });
    }

    // Customers paying down their deni.
    if (d % 6 === 1) customerPays(date, 19, jane.id, Math.min(KES(400), owed.get(jane.id) ?? 0), 'mpesa');
    if (weekday === 1) {
      // Tumaini pays the week's milk every Monday, except the last two days.
      const recent = (billedOn.get(tumaini.id) ?? []).filter((b) => b.date > addDays(date, -2)).reduce((n, b) => n + b.cents, 0);
      customerPays(date, 10, tumaini.id, roundDown100((owed.get(tumaini.id) ?? 0) - recent), 'mpesa');
    }
    if (dom === 1 && !isToday) customerPays(date, 8, mama.id, owed.get(mama.id) ?? 0, 'cash');
    if (d === 18) customerPays(date, 11, watoto.id, owed.get(watoto.id) ?? 0, 'mpesa');
    if (d % 9 === 8) customerPays(date, 9, grace.id, owed.get(grace.id) ?? 0, 'cash');
    if (d === 14) customerPays(date, 18.5, peter.id, KES(300), 'cash');

    // Paying the milkmen: Wanjiru weekly in cash, Kiprono twice a month by M-Pesa.
    if (weekday === 6 && !isToday) paySupplier(date, 19, wanjiru.id, settleable(wanjiru.id, date, 2), 'cash');
    if ((dom === 5 || dom === 20) && !isToday) paySupplier(date, 12, kiprono.id, settleable(kiprono.id, date, 5), 'mpesa');

    milkMl = available - walkInMl;

    // Staff present (the owner taps them in each morning; today is left to try).
    if (!isToday && weekday !== 0) {
      for (const e of [brian, faith, kevin]) {
        if (e === kevin && rand() < 0.15) continue;
        presence.push({ shopId, employeeId: e.id, businessDate: date, markedBy: ownerId, createdAt: at(date, 7) });
      }
    }

    // The seller started closing shifts a week ago; yesterday's waits for the owner.
    if (d >= 1 && d <= 7) {
      const closedAt = at(date, 20.75);
      const takings = expectedTakings(
        rows.slice(dayStart).map((r) => ({ kind: r.kind, paymentMethod: r.paymentMethod ?? null, amountCents: r.amountCents ?? 0 })),
      );
      const float = KES(1000);
      const expectedCash = float + takings.cashCents;
      const pending = d === 1;
      const cashOff = pending ? -KES(200) : [0, -KES(50), 0, KES(20), 0, -KES(100), 0][d - 1];
      const milkOff = pending ? -L(1.5) : d === 5 ? -L(0.5) : 0;
      closes.push({
        shopId, businessDate: date, periodStart: lastCloseAt, closedAt, closedBy: seller.id, openingFloatCents: float,
        expectedCashCents: expectedCash, countedCashCents: Math.max(0, expectedCash + cashOff),
        expectedMpesaCents: takings.mpesaCents, countedMpesaCents: Math.max(0, takings.mpesaCents),
        expectedMilkMl: milkMl, countedMilkMl: Math.max(0, milkMl + milkOff),
        note: pending ? 'Short KSh 200, I think I gave wrong change' : null,
        status: pending ? 'submitted' : 'approved',
        reviewedBy: pending ? null : ownerId,
        reviewedAt: pending ? null : at(date, 21.5),
      });
      lastCloseAt = closedAt;
    }
  }

  // --- write it all -------------------------------------------------------------------
  for (let i = 0; i < rows.length; i += 400) await tx.insert(ledgerEntries).values(rows.slice(i, i + 400));
  await tx.insert(deliverySubmissions).values(submissions);
  await tx.insert(employeeAdvances).values(advances);
  await tx.insert(shiftCloses).values(closes);
  await tx.insert(attendance).values(presence);
  await tx.insert(auditLog).values({
    shopId,
    userId: ownerId,
    action: 'demo.populate',
    entityType: 'shop',
    entityId: shopId,
    data: { entries: rows.length, days: DEMO_HISTORY_DAYS },
  });

  return { sellerId: seller.id, supplierUserId: supplierUser.id, entries: rows.length };
}
