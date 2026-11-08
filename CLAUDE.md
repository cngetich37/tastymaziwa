# CLAUDE.md — TastyMaziwa

TastyMaziwa ("tasty milk" in Swahili) is a profit tracker for small **Kenyan milk shops** (a *maziwa* duka). It is **multi-tenant**: anyone can sign up and gets their own private shop. The owner buys milk in bulk from a milkman, sells it by the litre for cash, M-Pesa or on credit (*deni*), and needs to know every day: how much came in, how much sold, who owes what, and whether the shop made money.

The original product spec is in `docs/blueprint.md`. The prioritised feature plan is in `docs/ROADMAP.md`. Read the roadmap before starting feature work, and tick items off as they ship.

## Who uses it, and what that means for the code

- **One owner or attendant, on a cheap Android phone, behind the counter.** Design mobile-first at 360px width. Thumb-sized tap targets (44px minimum; inputs and buttons use `h-11`). Recording a sale should take no more than 3 taps.
- **Connectivity is patchy and data costs money.** Keep client JS small, avoid heavy client libraries, and prefer Server Components.
- **Currency is KES and volume is litres.** Always format with `formatKES` / `formatLitres` from `src/lib/money.ts`.
- **Language.** English UI for now. Keep user-facing strings simple, because Swahili (`sw-KE`) is on the roadmap.

## Commands

```bash
npm run dev            # http://localhost:9002 (Turbopack). The local DB migrates itself.
npm run build          # production build
npm run lint           # ESLint 9 flat config (eslint.config.mjs)
npm run typecheck      # tsc --noEmit
npm test               # Vitest: unit tests + integration tests on in-memory Postgres
npm run test:e2e       # Playwright on a phone viewport. Run `npm run build` first.

npm run db:seed        # a demo shop + verified owner (owner@example.com, password printed once)
npm run db:seed -- --demo   # ...plus two weeks of demo trading
npm run db:generate    # create a migration after editing src/db/schema.ts
npm run db:migrate     # apply migrations (required for hosted Postgres)
npm run db:studio      # browse the database
```

**First run:** copy `.env.example` to `.env.local` and set `AUTH_SECRET` (`npx auth secret`). Then run `npm run db:seed -- --demo` followed by `npm run dev`. Or skip the seed and sign up at `/signup`.

**Emails in development** (sign-up codes, sign-in codes, reset links, invites) are written to `.data/outbox/*.json` and printed in the dev server log. Nothing is sent unless `SMTP_HOST` is set.

**PGlite is single-process.** Stop `npm run dev` before running `db:*` scripts against the local database, or they will fight over `.data/pglite`.

## Stack

- **Next.js 16 App Router + React 19**, TypeScript strict. `src/proxy.ts` (formerly middleware). Route params and `searchParams` are async (`await props.searchParams`).
- **Tailwind CSS v4** (CSS-first config in `src/app/globals.css`, using `@theme` and `tw-animate-css`), with shadcn/ui primitives in `src/components/ui`. That folder is generated code: change it with the shadcn CLI, don't hand-edit it. Lint skips it.
- **PostgreSQL + Drizzle ORM.** Locally it runs on embedded **PGlite** (Postgres in WASM) in `.data/pglite`, so there's nothing to install. With `DATABASE_URL` set it uses hosted Postgres through `postgres-js`.
- **Auth.js (next-auth v5)**, JWT sessions, two Credentials providers: `password` and `email-code` (passwordless; also completes sign-up). Scrypt password hashes. Roles are `owner` and `attendant`, per shop. See *Authentication* below.
- **Nodemailer** over SMTP for email; a file outbox in development and tests.
- **Zod 4** schemas shared by the forms (react-hook-form) and the server actions.
- **Vitest** + **Playwright**, with CI in `.github/workflows/ci.yml`.
- **Vercel** hosting, with Vercel Cron in `vercel.json` (see *Deployment* below).
- No AI SDK is installed yet. Add one when the first AI feature on the roadmap starts.

## Layout

```
src/
  app/
    (app)/            signed-in pages: / (Today), /sales, /deliveries (per day, ?date= for owners),
                      /customers[/id], /suppliers[/id], /ledger, /settings (owner), /account
    (auth)/           signed-out pages: /login, /signup, /forgot-password, /reset-password
    actions.ts        signed-in server actions, each wrapped in defineAction
    auth-actions.ts   signed-out server actions (definePublicAction): sign-up, codes, reset
    api/auth/         Auth.js handlers
    api/cron/         bill-subscriptions (Bearer CRON_SECRET), for a scheduler
  db/
    schema.ts         single source of truth for tables → `npm run db:generate`
    client.ts         createDb/migrateDb (usable from scripts and tests)
    index.ts          getDb() for app code (server-only, cached on globalThis)
  server/             server-only logic
    ledger.ts         every ledger WRITE: one DB transaction + audit row each
    queries.ts        read models (SQL aggregates → pure calc functions)
    action.ts         defineAction / definePublicAction: auth + role + Zod + errors
    session.ts        currentUser / requireUser(roles) -> { id, role, shopId, ... }
    auth/             accounts.ts (all auth flows), tokens.ts (codes/links),
                      rate-limit.ts, mailer.ts, emails.ts, config.ts
    users.ts, password.ts
  lib/                isomorphic and pure: safe on the client
    money.ts          cents/millilitre parsing, line totals, formatting
    dates.ts          Africa/Nairobi business dates
    calc/             summarize, balances, dailySeries, FIFO credit allocation
    validation.ts     Zod schemas + Kenyan phone normalisation
  components/
    forms/            entry-forms.tsx (all forms), fields.tsx, use-action-form.ts
drizzle/              generated SQL migrations (commit them; never edit applied ones)
e2e/                  Playwright specs
scripts/              seed, migrate (run with tsx)
```

## Multi-tenancy: every row belongs to a shop

`shops` is the tenant. `users`, `customers`, `suppliers`, `subscriptions`, `ledger_entries` and `audit_log` all have `shop_id`. **This is the rule that must never break: one shop must never see or change another shop's data.**

- **Every query filters by `shopId`, and every insert sets it.** Services get it from `actor.shopId`; queries take `shopId` as their second argument. Take it from the session (`requireUser()` / `defineAction`), **never from client input**.
- **Look up by id *and* shop:** `where(and(eq(t.id, id), eq(t.shopId, actor.shopId)))`. A bare `eq(t.id, id)` on a client-supplied id is a cross-tenant bug.
- The database backs this up: composite foreign keys `(customer_id, shop_id) -> customers(id, shop_id)` (and likewise for suppliers, subscriptions and reversals) make it impossible for a ledger row to reference another shop's records, even if a query is wrong.
- Every new table holding shop data gets `shop_id` (with an index), and every new service or query gets a tenant-isolation test (see the `tenant isolation` block in `src/server/ledger.test.ts`).
- The cron route loops over all shops and bills each one with `systemActor(shopId)`.

## Authentication

| Flow | How |
|---|---|
| Sign up | `/signup`: shop name, name, email, password, then a 6-digit code is emailed. Entering it creates the **shop + owner** and signs in (`email-code` provider, `intent: 'signup'`). The pending account lives only in `auth_tokens.data` until verified. |
| Sign in | Password (`password` provider) **or** passwordless: email, then a 6-digit code, then the `email-code` provider. |
| Forgot password | `/forgot-password` sends a single-use link (30 min) to `/reset-password?token=...`. Resetting bumps `session_version`, so every other session ends. |
| Staff | Owners invite by email from Settings; the invite is a 72 h set-password link, and invitees can also sign in with a code straight away. From each member's menu, owners can resend a pending invite (the old link dies), switch the role between attendant and owner (never their own, so a shop always keeps an owner; live sessions pick it up at the next 5-minute re-check), and deactivate or reactivate. |
| Account | `/account`: change name, email (confirmed by a code to the new address) and password (signs out other devices). |
| Sessions | JWT cookie; **30 min idle** timeout (each request slides it), **12 h hard limit**, user row re-checked every 5 min (deactivated or password changed: signed out). `SessionTimeout` mirrors the idle timer in the browser and signs the tab out. All configurable via `SESSION_*` env vars. |

Security rules for auth code:
- Request endpoints (sign-up, code, reset) **never reveal whether an email exists**: same response either way, and mail is only sent when there's something to send.
- Codes and link tokens are stored only as **HMAC-SHA256 (keyed by AUTH_SECRET)**, are single-use, and expire. Codes allow 5 attempts. `verifyCode` runs **outside** any transaction so failed attempts stay counted.
- Rate limits (`server/auth/rate-limit.ts`, DB-backed): 3 emails per address and 15 per IP per 15 min; 5 failed password attempts lock that address for 15 min (email codes still work).
- Links in emails use `appUrl()` (APP_URL / Vercel URL), **never the request Host header** (that would allow reset-link poisoning).
- After a password change the current session is kept alive via `updateSession({ sv, svProof })`. The jwt callback only accepts a new session version with a valid server HMAC, because `update()` can also be triggered from the browser.

## Domain model: the ledger is the source of truth

`ledger_entries` is an **append-only** event log. Every balance and report is derived from it, and nothing caches a balance.

| kind | meaning | sign of money |
|---|---|---|
| `delivery` | milk bought from a supplier (adds to what the shop owes them) | cost |
| `sale` | milk sold; `payment_method` is `cash`, `mpesa` or `credit` (credit needs `customer_id`) | revenue |
| `customer_payment` | customer pays down credit (`cash`/`mpesa`) | in |
| `supplier_payment` | shop pays the milkman | out |
| `expense` | operating cost, with `expense_category` | out |
| `spoilage` | milk written off (volume only) | — |

The derived figures (see `src/lib/calc/summary.ts`):
- **Stock on hand** = delivered − sold − spoiled (all time).
- **Customer balance** = credit sales − customer payments.
- **Supplier payable** = delivery cost − supplier payments.
- **Gross profit** = sales − delivery cost. **Net profit** = gross − expenses.
- **Outstanding credit**: payments are applied to the customer's oldest sales first (`allocatePayments`).

The database enforces these rules. Don't work around them:
- A trigger rejects `UPDATE`/`DELETE` on `ledger_entries` and `audit_log` (migration `0001_append_only.sql`).
- **Corrections are reversals.** `reverseEntry` inserts the negated row with `reverses_id` set, dated on the original's business day. An entry can only be reversed once, and a reversal can't itself be reversed.
- CHECK constraints: original rows are non-negative; a credit sale must have a customer; deliveries and supplier payments must have a supplier.
- `idempotency_key` is unique. Subscription billing uses `sub:<subscriptionId>:<date>`, so running it twice bills nothing extra.

## Conventions

### Money, volume and dates
- Money is **integer cents** and volume is **integer millilitres** (`bigint` columns, `mode: 'number'`). Never use floats. Parse user input with `kesToCents` / `litresToMl`, which reject bad input and never round silently. Compute totals with `lineTotalCents`.
- Group by **`business_date`**, the Africa/Nairobi calendar day stored on each entry. Use `todayBusinessDate()` and never `new Date().toDateString()` or server-local dates.
- Put new business maths in `src/lib/calc/` as pure functions with unit tests.

### Writing data
- UI mutations go through **server actions in `src/app/actions.ts`**, each built with `defineAction({ schema, roles }, handler)`. Server actions are public HTTP endpoints, so the wrapper's auth, role check and Zod parse are mandatory. Never export an unwrapped action.
- Actions are thin: they call a service in `src/server/ledger.ts` or `src/server/auth/accounts.ts`. Services take `(db, actor, input)` (the actor carries `shopId`), run in `db.transaction`, and write an `audit_log` row.
- Signed-out actions go in `src/app/auth-actions.ts` with `definePublicAction`, and must rate-limit.
- Business-rule failures throw `DomainError`; its message is shown to the user. Anything else is logged and gets a generic error.
- **Route handlers only for external callers** (cron, future M-Pesa callbacks). They do their own auth: a bearer secret compared with `timingSafeEqual`, or a signature check.
- Roles: an **attendant** records sales and deliveries only: litres, payment method and (for credit) the customer, dated today. Prices come from the owner: the shop's selling price (`shops.sale_price_per_litre_cents`, set in Settings) and each supplier's agreed price. Attendants never see buying prices, delivery costs, profit, customers' or suppliers' pages, or the ledger. An **owner** does everything else: sets prices (and may override the price of one entry), records payments, spoilage and expenses, dates entries on past days, reverses entries, and manages customers, suppliers, subscriptions and users.
- **Prices and dates are enforced in the services** (`resolvePrice` / `entryDateFor` in `server/ledger.ts`), not only hidden in the UI. Page data for attendants must not carry costs either (see `app/(app)/layout.tsx`).

### Reading data
- Pages are async Server Components. Start with `const user = await requireUser()` (or `requireUser(['owner'])`), then `const db = await getDb()`, then call `src/server/queries.ts` with `user.shopId`. Pass plain data to client components.
- Aggregate in SQL (`sum`, `group by`) and derive in `lib/calc`. Don't load the whole ledger into JS.

### Forms
- Each form uses `useActionForm(schema, action, defaults, { success })` with the field components in `components/forms/fields.tsx`. Inputs are strings: the client validates for instant feedback, and the server parses the raw strings again.
- Money and litre inputs use `kind="money"` / `kind="litres"` (`inputMode="decimal"`, never `type="number"`).
- Phone numbers are normalised to E.164 (`+2547…`) by the Zod schema.
- Wrap optional inputs in `optionalField(inner)` (in `lib/validation.ts`). In zod 4 a `.transform()` around `.optional()` makes the key *required*, so `.optional()` must stay outermost. Use `{ error: '…' }` for messages (not `message` / `required_error`) and `z.flattenError(err)` (not `err.flatten()`).

### Schema changes
1. Edit `src/db/schema.ts`.
2. Run `npm run db:generate` and review the SQL in `drizzle/`.
3. Commit the schema change and its migration together. CI fails if they drift apart.
4. Never edit a migration that has already been applied. Write a new one.

### Style and security
- TypeScript strict and no `any`, except at driver boundaries with a comment.
- Use the `@/` import alias. Server-only modules start with `import 'server-only'`, except `db/client.ts` and the `server/` services, which scripts and tests also import.
- Components default to Server Components. Add `'use client'` only on interactive leaves.
- Use theme colours via tokens (`bg-primary`, `text-muted-foreground`). For money-out and negative figures use `text-red-600 dark:text-red-400`, because the theme's `destructive` is too dark in dark mode.
- Keep secrets out of git: use `.env.local` locally and Vercel environment variables in production. Document every new variable in `.env.example`.
- Redirect targets taken from user input must be relative paths (see `useCallbackUrl` in `app/(auth)/auth-forms.tsx`).

### Git
- Use Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).

## Deployment (Vercel)

- Every push to a branch gets a Preview deployment; merging to `master` deploys Production.
- Set these as Vercel project environment variables:
  - `DATABASE_URL` (required). Vercel has no persistent disk, so on Vercel the app refuses to start without it rather than falling back to PGlite. Use the provider's **pooled** connection string (Neon/Supabase). The client already uses a pool of 1 and `prepare: false` on Vercel.
  - `DATABASE_URL_UNPOOLED` (optional, recommended): a direct connection used only for migrations at deploy time. Neon's Vercel integration sets it automatically.
  - `AUTH_SECRET` (required).
  - `CRON_SECRET` (required for billing). Vercel Cron sends it automatically as `Authorization: Bearer …`.
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (required: sign-up, codes and resets all need email). Optional `APP_URL` for a custom domain.
- Point Preview at a separate database or Neon branch, never Production's.
- **Production deploys migrate the database automatically.** `vercel.json` sets the build command to `npm run vercel-build`, which runs `scripts/migrate-on-deploy.mts` and then `next build`. It applies pending migrations only when `VERCEL_ENV=production` (Preview builds skip it, so they can't touch the live database), prefers `DATABASE_URL_UNPOOLED`/`DIRECT_URL` over the pooled URL, and a failed migration fails the deploy so the previous version keeps serving. Because the new schema goes live a minute or two before the new code, **migrations must stay backward-compatible with the running code**: add columns/tables first, drop or rename only in a later deploy. `npm run db:migrate` still works manually. No seeding is needed in production: shops are created by signing up.
- `vercel.json` cron: `/api/cron/bill-subscriptions` runs at `0 3 * * *` UTC, which is 06:00 Nairobi. Vercel Hobby can fire anywhere within that hour; billing is idempotent, so retries and duplicates are harmless.
- Auth.js trusts the host automatically on Vercel; `AUTH_TRUST_HOST` is only for other hosts.

## Definition of done
1. `npm run lint`, `npm run typecheck` and `npm test` pass. For any UI flow change, `npm run build && npm run test:e2e` also passes.
2. New money, stock or date logic has unit tests. New services have an integration test in `src/server/**/*.test.ts`, including tenant isolation for anything touching shop data.
3. Works at 360px width and in dark mode.
4. New environment variables are in `.env.example`; schema changes have a migration.
5. `docs/ROADMAP.md` is updated.
