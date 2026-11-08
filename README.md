# TastyMaziwa

Daily milk sales, credit (*deni*) and profit for a Kenyan maziwa shop. It's built mobile-first, for one attendant on an Android phone.

## Quick start

```bash
npm install
cp .env.example .env.local        # then set AUTH_SECRET (npx auth secret)
npm run db:seed -- --demo         # prints the owner password once
npm run dev                       # http://localhost:9002
```

No database server is needed locally: it runs on embedded Postgres (PGlite) in `.data/`. Deployed on Vercel. Set `DATABASE_URL`, `AUTH_SECRET` and `CRON_SECRET` on the project and run `npm run db:migrate` against the production database. Full notes are under *Deployment* in `CLAUDE.md`.

## Checks

```bash
npm run lint && npm run typecheck && npm test
npm run build && npm run test:e2e
```

Read `CLAUDE.md` for architecture and conventions, and `docs/ROADMAP.md` for what's next.
