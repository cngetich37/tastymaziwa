# CLAUDE.md — TastyMaziwa

TastyMaziwa ("tasty milk" in Swahili) is a profit tracker for a small **Kenyan milk shop** (a *maziwa* duka). The owner buys milk in bulk from a milkman, sells it by the litre for cash, M-Pesa or on credit (*deni*), and needs to know every day: how much came in, how much sold, who owes what, and whether the shop made money.

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

npm run db:seed        # create the owner account (password printed once) + default supplier
npm run db:seed -- --demo   # ...plus two weeks of demo trading
npm run db:generate    # create a migration after editing src/db/schema.ts
npm run db:migrate     # apply migrations (required for hosted Postgres)
npm run db:studio      # browse the database
npm run user:create -- <username> <owner|attendant> "Full Name"
```

**First run:** copy `.env.example` to `.env.local` and set `AUTH_SECRET` (`npx auth secret`). Then run `npm run db:seed -- --demo` followed by `npm run dev`.

**PGlite is single-process.** Stop `npm run dev` before running `db:*` or `user:create` scripts against the local database, or they will fight over `.data/pglite`.

## Stack

- **Next.js 16 App Router + React 19**, TypeScript strict. `src/proxy.ts` (formerly middleware). Route params and `searchParams` are async (`await props.searchParams`).
- **Tailwind CSS v4** (CSS-first config in `src/app/globals.css`, using `@theme` and `tw-animate-css`), with shadcn/ui primitives in `src/components/ui`. That folder is generated code: change it with the shadcn CLI, don't hand-edit it. Lint skips it.
- **PostgreSQL + Drizzle ORM.** Locally it runs on embedded **PGlite** (Postgres in WASM) in `.data/pglite`, so there's nothing to install. With `DATABASE_URL` set it uses hosted Postgres through `postgres-js`.
- **Auth.js (next-auth v5)** with a Credentials provider against the `users` table, scrypt password hashes and JWT sessions (12h). Roles are `owner` and `attendant`.
- **Zod 4** schemas shared by the forms (react-hook-form) and the server actions.
- **Vitest** + **Playwright**, with CI in `.github/workflows/ci.yml`.
- **Vercel** hosting, with Vercel Cron in `vercel.json` (see *Deployment* below).
- No AI SDK is installed yet. Add one when the first AI feature on the roadmap starts.

## Layout

```
src/
  app/
    (app)/            authenticated pages: / (Today), /ledger, /credit, /settings (owner)
    login/            sign-in page
    actions.ts        ALL server actions ('use server'), each wrapped in defineAction
    api/auth/         Auth.js handlers
    api/cron/         bill-subscriptions (Bearer CRON_SECRET), for a scheduler
  db/
    schema.ts         single source of truth for tables → `npm run db:generate`
    client.ts         createDb/migrateDb (usable from scripts and tests)
    index.ts          getDb() for app code (server-only, cached on globalThis)
  server/             server-only logic
    ledger.ts         every ledger WRITE: one DB transaction + audit row each
    queries.ts        read models (SQL aggregates → pure calc functions)
    action.ts         defineAction: auth + role + Zod + error mapping + revalidate
    session.ts        currentUser / requireUser(roles)
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
scripts/              seed, migrate, create-user (run with tsx)
```

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
- Actions are thin: they call a service in `src/server/ledger.ts`. Services take `(db, actor, input)`, run in `db.transaction`, and write an `audit_log` row.
- Business-rule failures throw `DomainError`; its message is shown to the user. Anything else is logged and gets a generic error.
- **Route handlers only for external callers** (cron, future M-Pesa callbacks). They do their own auth: a bearer secret compared with `timingSafeEqual`, or a signature check.
- Roles: an **attendant** can record sales, deliveries, customer payments and spoilage, add customers, and bill subscriptions. An **owner** can additionally see profit and record expenses and supplier payments. Owners also reverse entries and manage suppliers, subscriptions and users.

### Reading data
- Pages are async Server Components. Start with `await requireUser()` (or `requireUser(['owner'])`), then `const db = await getDb()`, then call `src/server/queries.ts`. Pass plain data to client components.
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
- Redirect targets taken from user input must be relative paths (see `login-form.tsx`).

### Git
- Use Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).

## Deployment (Vercel)

- Every push to a branch gets a Preview deployment; merging to `master` deploys Production.
- Set these as Vercel project environment variables:
  - `DATABASE_URL` (required). Vercel has no persistent disk, so the PGlite fallback can't run there. Use the provider's **pooled** connection string (Neon/Supabase). The client already uses a pool of 1 and `prepare: false` on Vercel.
  - `AUTH_SECRET` (required).
  - `CRON_SECRET` (required for billing). Vercel Cron sends it automatically as `Authorization: Bearer …`.
- Point Preview at a separate database or Neon branch, never Production's.
- **Migrations are not run during the build.** After merging a schema change, run `DATABASE_URL=<prod> npm run db:migrate` before (or immediately after) the deploy. First deploy: also run `npm run db:seed` to create the owner.
- `vercel.json` cron: `/api/cron/bill-subscriptions` runs at `0 3 * * *` UTC, which is 06:00 Nairobi. Vercel Hobby can fire anywhere within that hour; billing is idempotent, so retries and duplicates are harmless.
- Auth.js trusts the host automatically on Vercel; `AUTH_TRUST_HOST` is only for other hosts.

## Definition of done
1. `npm run lint`, `npm run typecheck` and `npm test` pass. For any UI flow change, `npm run build && npm run test:e2e` also passes.
2. New money, stock or date logic has unit tests. New services have an integration test in `src/server/*.test.ts`.
3. Works at 360px width and in dark mode.
4. New environment variables are in `.env.example`; schema changes have a migration.
5. `docs/ROADMAP.md` is updated.
