CREATE TYPE "public"."entry_kind" AS ENUM('delivery', 'sale', 'customer_payment', 'supplier_payment', 'expense', 'spoilage');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'mpesa', 'credit');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'attendant');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "entry_kind" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"business_date" date NOT NULL,
	"volume_ml" bigint DEFAULT 0 NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"unit_price_cents" bigint,
	"payment_method" "payment_method",
	"customer_id" uuid,
	"supplier_id" uuid,
	"subscription_id" uuid,
	"expense_category" text,
	"due_date" date,
	"note" text,
	"reverses_id" uuid,
	"idempotency_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_reverses_id_unique" UNIQUE("reverses_id"),
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_originals_non_negative" CHECK ("ledger_entries"."reverses_id" is not null or ("ledger_entries"."amount_cents" >= 0 and "ledger_entries"."volume_ml" >= 0)),
	CONSTRAINT "ledger_sale_has_method" CHECK ("ledger_entries"."kind" <> 'sale' or "ledger_entries"."payment_method" is not null),
	CONSTRAINT "ledger_credit_sale_has_customer" CHECK ("ledger_entries"."payment_method" is distinct from 'credit' or "ledger_entries"."customer_id" is not null),
	CONSTRAINT "ledger_customer_payment_has_customer" CHECK ("ledger_entries"."kind" <> 'customer_payment' or ("ledger_entries"."customer_id" is not null and "ledger_entries"."payment_method" in ('cash', 'mpesa'))),
	CONSTRAINT "ledger_supplier_entries_have_supplier" CHECK ("ledger_entries"."kind" not in ('delivery', 'supplier_payment') or "ledger_entries"."supplier_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"daily_ml" bigint NOT NULL,
	"price_per_litre_cents" bigint NOT NULL,
	"start_date" date NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_positive" CHECK ("subscriptions"."daily_ml" > 0 and "subscriptions"."price_per_litre_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"default_price_per_litre_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'attendant' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_id_ledger_entries_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_business_date_idx" ON "ledger_entries" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "ledger_customer_idx" ON "ledger_entries" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "ledger_supplier_idx" ON "ledger_entries" USING btree ("supplier_id");