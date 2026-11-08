-- Multi-tenancy (shops) + email-based auth.
-- Hand-ordered from drizzle-kit output: existing rows are backfilled into a
-- single shop before columns become NOT NULL, and UNIQUE(id, shop_id) is
-- created before the composite foreign keys that reference it.

-- 1. New tables and types ----------------------------------------------------
CREATE TYPE "public"."auth_token_purpose" AS ENUM('signup', 'login_code', 'password_reset', 'email_change');--> statement-breakpoint
CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"token_hash" text NOT NULL,
	"data" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 2. Drop single-column FKs that become composite (same-shop) FKs ------------
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_supplier_id_suppliers_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_subscription_id_subscriptions_id_fk";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_reverses_id_ledger_entries_id_fk";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
DROP INDEX "audit_created_at_idx";--> statement-breakpoint
DROP INDEX "ledger_business_date_idx";--> statement-breakpoint

-- 3. New columns, nullable for now ---------------------------------------------
ALTER TABLE "users" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "shop_id" uuid;--> statement-breakpoint

-- 4. Backfill: everything that existed before belonged to one shop -----------
INSERT INTO "shops" ("name")
SELECT 'My Shop'
WHERE EXISTS (SELECT 1 FROM "users")
   OR EXISTS (SELECT 1 FROM "customers")
   OR EXISTS (SELECT 1 FROM "suppliers")
   OR EXISTS (SELECT 1 FROM "ledger_entries");--> statement-breakpoint
UPDATE "users" SET
  "shop_id" = (SELECT "id" FROM "shops" LIMIT 1),
  -- Pre-email accounts get a placeholder address they can change on the
  -- Account page; usernames that already look like emails are kept.
  "email" = CASE WHEN "username" LIKE '%@%' THEN lower("username")
                 ELSE lower("username") || '@tastymaziwa.invalid' END,
  "email_verified_at" = now();--> statement-breakpoint
UPDATE "customers" SET "shop_id" = (SELECT "id" FROM "shops" LIMIT 1);--> statement-breakpoint
UPDATE "suppliers" SET "shop_id" = (SELECT "id" FROM "shops" LIMIT 1);--> statement-breakpoint
UPDATE "subscriptions" SET "shop_id" = (SELECT "id" FROM "shops" LIMIT 1);--> statement-breakpoint
-- The ledger and audit log are append-only; allow this one structural backfill.
ALTER TABLE "ledger_entries" DISABLE TRIGGER "ledger_entries_append_only";--> statement-breakpoint
UPDATE "ledger_entries" SET "shop_id" = (SELECT "id" FROM "shops" LIMIT 1);--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE TRIGGER "ledger_entries_append_only";--> statement-breakpoint
ALTER TABLE "audit_log" DISABLE TRIGGER "audit_log_append_only";--> statement-breakpoint
UPDATE "audit_log" SET "shop_id" = (SELECT "id" FROM "shops" LIMIT 1);--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE TRIGGER "audit_log_append_only";--> statement-breakpoint

-- 5. Tighten -----------------------------------------------------------------
ALTER TABLE "users" ALTER COLUMN "shop_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "shop_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ALTER COLUMN "shop_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "shop_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ALTER COLUMN "shop_id" SET NOT NULL;--> statement-breakpoint

-- 6. Uniques first (composite FKs reference them) -----------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_id_shop_unique" UNIQUE("id","shop_id");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_id_shop_unique" UNIQUE("id","shop_id");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_id_shop_unique" UNIQUE("id","shop_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_id_shop_unique" UNIQUE("id","shop_id");--> statement-breakpoint

-- 7. Foreign keys --------------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_same_shop_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_customer_same_shop_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_supplier_same_shop_fk" FOREIGN KEY ("supplier_id","shop_id") REFERENCES "public"."suppliers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_subscription_same_shop_fk" FOREIGN KEY ("subscription_id","shop_id") REFERENCES "public"."subscriptions"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_reverses_same_shop_fk" FOREIGN KEY ("reverses_id","shop_id") REFERENCES "public"."ledger_entries"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 8. Indexes -------------------------------------------------------------------
CREATE INDEX "users_shop_idx" ON "users" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "customers_shop_idx" ON "customers" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "suppliers_shop_idx" ON "suppliers" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "ledger_shop_date_idx" ON "ledger_entries" USING btree ("shop_id","business_date");--> statement-breakpoint
CREATE INDEX "audit_shop_created_idx" ON "audit_log" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_tokens_email_purpose_idx" ON "auth_tokens" USING btree ("email","purpose");--> statement-breakpoint
CREATE INDEX "auth_tokens_hash_idx" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "rate_limit_key_created_idx" ON "rate_limit_events" USING btree ("key","created_at");
