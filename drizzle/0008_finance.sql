CREATE TABLE "expense_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"category" text NOT NULL,
	"monthly_cents" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_budgets_shop_category_unique" UNIQUE("shop_id","category"),
	CONSTRAINT "expense_budgets_non_negative" CHECK ("expense_budgets"."monthly_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit_cents" bigint;--> statement-breakpoint
ALTER TABLE "expense_budgets" ADD CONSTRAINT "expense_budgets_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;