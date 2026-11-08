# TastyMaziwa Roadmap

This is the plan for turning the prototype into a complete, modern milk-shop app. Items are ordered by dependency and value: **P0** is the foundation and must come first, **P1** is the core business value, **P2** makes the app stand out, and **P3** covers expansion.

Mark each item done with `[x]` as it ships.

---

## P0: Foundation ✅ (done on branch `feat/p0-foundation`)

- [x] **Real database.** PostgreSQL + Drizzle (`src/db/schema.ts`, migrations in `drizzle/`). It runs on embedded PGlite locally and hosted Postgres via `DATABASE_URL`. Seeding is a script (`npm run db:seed [-- --demo]`), not part of the read path.
- [x] **Ledger model.** An append-only event ledger with integer cents and millilitres. Balances, stock and profit are all derived. A DB trigger forbids edits and deletes, and corrections are reversals. *(Not textbook double-entry: one row per event, with typed kinds. Revisit if we add full accounting export.)*
- [x] **Locked-down auth.** Users live in the DB with scrypt hashes, and there's no fallback secret. Pages, server actions and the cron route each check auth themselves. Owner/attendant roles are in place, with a user-management page in Settings.
- [x] **Validation.** Zod schemas are shared between forms and server actions. Kenyan phones are normalised to E.164.
- [x] **Tests and CI.** Vitest covers the pure calc functions plus integration tests on in-memory Postgres. Playwright covers the daily flow on a Pixel 7 viewport. GitHub Actions runs lint, typecheck, tests, a migration-drift check, build and e2e. `ignoreBuildErrors` is gone.
- [x] **Stack refresh.** Next.js 16 (`proxy.ts`, async params), React 19, Tailwind v4 + `tw-animate-css`, Recharts 3, ESLint 9 flat config, `next/font`.
- [x] **Audit log.** Every write records who did what and when, in the same transaction.

**Follow-ups found during P0:**
- [ ] Group the Credit page's unpaid list by customer. Subscription customers produce one row per day.
- [ ] Turn on Cache Components (`cacheComponents: true`) once the data layer settles.
- [ ] Deactivate users and reset passwords from Settings. Today you can only add users.
- [ ] Archive customers and suppliers from the UI. The `archived_at` columns already exist.
- [ ] Rate-limit sign-in attempts.
- [ ] Regenerate the remaining unused shadcn components with the current CLI, or delete them.

## P1: Core business features

### Payments
- [ ] **M-Pesa STK Push (Lipa na M-Pesa).** The attendant types a phone number and the amount, and the customer gets a PIN prompt. It uses the Safaricom Daraja API, with the callback at `/api/mpesa/callback`.
  - Cache the OAuth token (it lasts about 1 hour). Lock against double-taps. Make processing idempotent on `MpesaReceiptNumber`.
  - Use the sandbox in development and expose the callback with ngrok or Cloudflare Tunnel. Going live needs KYC and takes weeks, so start that early.
- [ ] **Till/Paybill reconciliation.** Use C2B URL registration so that payments customers make directly to the shop's till number are auto-matched to customers by phone number. Anything that can't be matched goes to a "match this payment" inbox.
- [ ] **Payment method on every sale**: cash, M-Pesa or *deni* (credit). The daily close shows expected cash in the drawer against M-Pesa received.

### Credit (*deni*) management
- [ ] **Customer ledger page.** Shows every purchase and payment, the running balance, and a shareable statement.
- [ ] **Credit limits per customer.** Warn or block when a new credit sale would go over the limit.
- [ ] **Ageing report** with buckets for current, 1–7, 8–30 and 30+ days, and a "top debtors" card on the dashboard.
- [ ] **Automated reminders** by SMS (Africa's Talking) or WhatsApp (Business API with approved templates). Example: *"Habari Jane, salio lako TastyMaziwa ni KSh 850. Lipa kwa Till 123456."* The reminder includes a link that triggers STK Push.
- [ ] **Partial payments** applied oldest-first, with a receipt.

### Supplier (milkman) side
- [ ] **Supplier accounts.** Support several milkmen, each with deliveries, the price per litre, and payments made. Show the running payable.
- [ ] **Delivery quality notes**, such as rejected litres or a failed lactometer reading, which reduce what is owed.
- [ ] **Supplier statement** exportable as PDF to settle the weekly or monthly account.

### Stock and wastage
- [ ] **Daily close wizard.** Opening stock + deliveries − sales − spoilage = expected closing stock. The attendant enters the actual count, and the app records the variance.
- [ ] **Spoilage reasons** (sour, spilled, power outage) with trends over time.
- [ ] **Low-stock and over-stock alerts** based on typical sales for that weekday.

### Subscriptions (standing orders)
- [x] **Idempotent daily billing**, run daily at 06:00 Nairobi by Vercel Cron (`vercel.json`) and keyed by date.
- [ ] **Pause and skip days.** For example, "Mama Wanjiku is away Monday–Wednesday."
- [ ] **Delivery route list.** A printable or phone-friendly list of today's subscription deliveries, with tick-off as each one is delivered.

### Expenses and reporting
- [ ] **Expense tracking** with categories (transport, packaging, electricity/refrigeration, rent, wages) and receipt photos.
- [ ] **P&L report** for any date range: revenue, cost of milk, spoilage cost, expenses and net profit. Export as CSV or PDF.
- [ ] **Margin per litre** over time, the single most important number for this business.

## P2: Standout features

- [ ] **Offline-first PWA.** The app installs to the home screen. Sales are recorded offline into IndexedDB (Dexie) and sync when the connection returns, with a visible "3 unsynced" badge. Serwist handles the service worker.
- [ ] **Swahili UI (`sw-KE`)** with a language toggle, using `next-intl`.
- [ ] **AI daily briefing.** Genkit is already installed. A scheduled flow writes a 3-line summary each evening: *"Sold 52L (+8% vs last Tuesday). 4L spoiled — 2nd day in a row, check the fridge. Jane is 21 days overdue on KSh 1,200."* Send it to the owner by WhatsApp or push notification.
- [ ] **Demand forecasting.** Suggest tomorrow's order quantity from weekday patterns, holidays and recent trend, so the owner buys less milk that ends up spoiling. Start with a simple moving average by weekday; only move to ML if that proves not good enough.
- [ ] **Voice or chat entry.** For example, *"Nimeuza lita tano kwa Jane kwa deni"* ("I sold five litres to Jane on credit") becomes a structured credit sale, via an LLM with tool calling and a confirmation step.
- [ ] **Receipt and invoice OCR.** Photograph the milkman's delivery slip to pre-fill the delivery form.
- [ ] **Customer self-service link.** A tokenised page where a customer sees their balance and pays by STK Push, with no login.
- [ ] **Loyalty.** "Buy 20 litres, get 1 free" stamp cards tracked by phone number.
- [ ] **Command palette (⌘K)** for fast navigation and quick entry on desktop.

## P3: Expansion

- [ ] **Multi-shop / multi-tenant.** One owner with several outlets, per-shop dashboards and a consolidated view. Use row-level tenancy (`shop_id` on every table).
- [ ] **eTIMS integration** (KRA electronic tax invoices) if the business crosses the VAT/turnover threshold.
- [ ] **USSD access** for an attendant without a smartphone, via Africa's Talking USSD.
- [ ] **Cold-chain sensor.** Read fridge temperature from a cheap IoT sensor and alert before milk spoils.
- [ ] **Accounting export** to QuickBooks or Xero.
- [ ] **Native wrapper** (Capacitor) if the PWA's limits matter, for example for Bluetooth receipt printers.

---

## Suggested build order

1. P0 database + ledger + auth + tests, as one milestone.
2. M-Pesa STK Push + payment method on sales.
3. Credit ledger, ageing and SMS reminders.
4. Daily close wizard + supplier accounts.
5. Offline PWA.
6. AI briefing + forecasting.

## Research references
- Next.js 16 release notes: https://nextjs.org/blog/next-16
- shadcn/ui Tailwind v4 migration: https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4
- Next.js 16 PWA with offline support (Serwist): https://blog.logrocket.com/nextjs-16-pwa-offline-support/
- Daraja STK Push flow reference: https://github.com/symo101/daraja-stk-push-docs
- M-Pesa + Next.js integration notes (token caching, idempotency): https://brandon-ogola-platform.vercel.app/writing/mpesa-nextjs-integration
- Africa's Talking Node SDK (SMS, WhatsApp, USSD): https://www.npmjs.com/package/africastalking
- Competitor reference, Kenyan duka POS with cash/M-Pesa/deni: https://dakasale.vercel.app
- Competitor reference, offline dairy app with M-Pesa: https://dairybook.pages.dev/
