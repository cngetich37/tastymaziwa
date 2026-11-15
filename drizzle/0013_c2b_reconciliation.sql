CREATE TYPE "public"."c2b_status" AS ENUM('stk', 'matched_sale', 'posted_payment', 'unmatched', 'ignored');--> statement-breakpoint
CREATE TABLE "mpesa_c2b_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"trans_id" text NOT NULL,
	"trans_type" text,
	"trans_time" timestamp with time zone NOT NULL,
	"business_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"business_shortcode" text NOT NULL,
	"bill_ref" text,
	"msisdn" text,
	"payer_name" text,
	"org_balance_cents" bigint,
	"status" "c2b_status" NOT NULL,
	"customer_id" uuid,
	"ledger_entry_id" uuid,
	"matched_by" uuid,
	"matched_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mpesa_c2b_transactions_trans_id_unique" UNIQUE("trans_id"),
	CONSTRAINT "mpesa_c2b_transactions_ledger_entry_id_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "mpesa_c2b_positive" CHECK ("mpesa_c2b_transactions"."amount_cents" > 0),
	CONSTRAINT "mpesa_c2b_linked" CHECK (("mpesa_c2b_transactions"."status" in ('unmatched', 'ignored')) = ("mpesa_c2b_transactions"."ledger_entry_id" is null))
);
--> statement-breakpoint
ALTER TABLE "mpesa_settings" ADD COLUMN "c2b_token_hash" text;--> statement-breakpoint
ALTER TABLE "mpesa_settings" ADD COLUMN "c2b_registered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mpesa_c2b_transactions" ADD CONSTRAINT "mpesa_c2b_transactions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_c2b_transactions" ADD CONSTRAINT "mpesa_c2b_transactions_matched_by_users_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_c2b_transactions" ADD CONSTRAINT "mpesa_c2b_customer_same_shop_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_c2b_transactions" ADD CONSTRAINT "mpesa_c2b_ledger_same_shop_fk" FOREIGN KEY ("ledger_entry_id","shop_id") REFERENCES "public"."ledger_entries"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mpesa_c2b_shop_date_idx" ON "mpesa_c2b_transactions" USING btree ("shop_id","business_date");--> statement-breakpoint
CREATE INDEX "mpesa_c2b_shop_status_idx" ON "mpesa_c2b_transactions" USING btree ("shop_id","status");