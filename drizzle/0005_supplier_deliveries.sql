CREATE TYPE "public"."delivery_submission_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'supplier';--> statement-breakpoint
CREATE TABLE "delivery_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"volume_ml" bigint NOT NULL,
	"note" text,
	"status" "delivery_submission_status" DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"ledger_entry_id" uuid,
	CONSTRAINT "delivery_submissions_ledger_entry_id_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "delivery_submissions_positive" CHECK ("delivery_submissions"."volume_ml" > 0),
	CONSTRAINT "delivery_submissions_review_consistent" CHECK (("delivery_submissions"."status" = 'pending' and "delivery_submissions"."reviewed_at" is null and "delivery_submissions"."ledger_entry_id" is null)
        or ("delivery_submissions"."status" = 'approved' and "delivery_submissions"."reviewed_at" is not null and "delivery_submissions"."ledger_entry_id" is not null)
        or ("delivery_submissions"."status" = 'rejected' and "delivery_submissions"."reviewed_at" is not null and "delivery_submissions"."ledger_entry_id" is null and "delivery_submissions"."review_note" is not null))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "delivery_submissions" ADD CONSTRAINT "delivery_submissions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_submissions" ADD CONSTRAINT "delivery_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_submissions" ADD CONSTRAINT "delivery_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_submissions" ADD CONSTRAINT "delivery_submissions_supplier_same_shop_fk" FOREIGN KEY ("supplier_id","shop_id") REFERENCES "public"."suppliers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_submissions" ADD CONSTRAINT "delivery_submissions_ledger_same_shop_fk" FOREIGN KEY ("ledger_entry_id","shop_id") REFERENCES "public"."ledger_entries"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_submissions_shop_status_idx" ON "delivery_submissions" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "delivery_submissions_shop_date_idx" ON "delivery_submissions" USING btree ("shop_id","business_date");--> statement-breakpoint
CREATE INDEX "delivery_submissions_supplier_idx" ON "delivery_submissions" USING btree ("supplier_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_supplier_same_shop_fk" FOREIGN KEY ("supplier_id","shop_id") REFERENCES "public"."suppliers"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_supplier_id_unique" UNIQUE("supplier_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_supplier_role" CHECK (("users"."role"::text = 'supplier') = ("users"."supplier_id" is not null));