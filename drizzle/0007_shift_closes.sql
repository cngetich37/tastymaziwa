CREATE TYPE "public"."shift_close_status" AS ENUM('submitted', 'approved');--> statement-breakpoint
CREATE TABLE "shift_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"period_start" timestamp with time zone,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid NOT NULL,
	"opening_float_cents" bigint DEFAULT 0 NOT NULL,
	"expected_cash_cents" bigint NOT NULL,
	"counted_cash_cents" bigint NOT NULL,
	"expected_mpesa_cents" bigint NOT NULL,
	"counted_mpesa_cents" bigint NOT NULL,
	"expected_milk_ml" bigint NOT NULL,
	"counted_milk_ml" bigint NOT NULL,
	"note" text,
	"status" "shift_close_status" DEFAULT 'submitted' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"spoilage_entry_id" uuid,
	CONSTRAINT "shift_closes_counts_non_negative" CHECK ("shift_closes"."opening_float_cents" >= 0 and "shift_closes"."counted_cash_cents" >= 0 and "shift_closes"."counted_mpesa_cents" >= 0 and "shift_closes"."counted_milk_ml" >= 0),
	CONSTRAINT "shift_closes_review_consistent" CHECK (("shift_closes"."status" = 'submitted') = ("shift_closes"."reviewed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_closes" ADD CONSTRAINT "shift_closes_spoilage_same_shop_fk" FOREIGN KEY ("spoilage_entry_id","shop_id") REFERENCES "public"."ledger_entries"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_closes_shop_closed_idx" ON "shift_closes" USING btree ("shop_id","closed_at");