CREATE TYPE "public"."mpesa_environment" AS ENUM('sandbox', 'production');--> statement-breakpoint
CREATE TYPE "public"."mpesa_purpose" AS ENUM('sale', 'customer_payment');--> statement-breakpoint
CREATE TYPE "public"."mpesa_shortcode_type" AS ENUM('paybill', 'till');--> statement-breakpoint
CREATE TYPE "public"."mpesa_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "mpesa_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"purpose" "mpesa_purpose" NOT NULL,
	"status" "mpesa_status" DEFAULT 'pending' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"phone" text NOT NULL,
	"business_date" date NOT NULL,
	"customer_id" uuid,
	"product_id" uuid,
	"volume_ml" bigint DEFAULT 0 NOT NULL,
	"unit_price_cents" bigint,
	"note" text,
	"callback_token_hash" text NOT NULL,
	"merchant_request_id" text,
	"checkout_request_id" text,
	"result_code" integer,
	"result_desc" text,
	"receipt_number" text,
	"ledger_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mpesa_requests_checkout_request_id_unique" UNIQUE("checkout_request_id"),
	CONSTRAINT "mpesa_requests_receipt_number_unique" UNIQUE("receipt_number"),
	CONSTRAINT "mpesa_requests_whole_shillings" CHECK ("mpesa_requests"."amount_cents" > 0 and "mpesa_requests"."amount_cents" % 100 = 0),
	CONSTRAINT "mpesa_requests_payment_has_customer" CHECK ("mpesa_requests"."purpose" <> 'customer_payment' or "mpesa_requests"."customer_id" is not null),
	CONSTRAINT "mpesa_requests_success_posted" CHECK ("mpesa_requests"."status" <> 'succeeded' or "mpesa_requests"."ledger_entry_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "mpesa_settings" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"environment" "mpesa_environment" DEFAULT 'sandbox' NOT NULL,
	"shortcode_type" "mpesa_shortcode_type" NOT NULL,
	"business_shortcode" text NOT NULL,
	"till_number" text,
	"account_reference" text NOT NULL,
	"consumer_key_enc" text NOT NULL,
	"consumer_secret_enc" text NOT NULL,
	"passkey_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_customer_same_shop_fk" FOREIGN KEY ("customer_id","shop_id") REFERENCES "public"."customers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_product_same_shop_fk" FOREIGN KEY ("product_id","shop_id") REFERENCES "public"."products"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_ledger_same_shop_fk" FOREIGN KEY ("ledger_entry_id","shop_id") REFERENCES "public"."ledger_entries"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_settings" ADD CONSTRAINT "mpesa_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mpesa_requests_shop_created_idx" ON "mpesa_requests" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE INDEX "mpesa_requests_shop_phone_status_idx" ON "mpesa_requests" USING btree ("shop_id","phone","status");