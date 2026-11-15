CREATE TYPE "public"."product_unit" AS ENUM('litre', 'piece', 'kg');--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" "product_unit" DEFAULT 'piece' NOT NULL,
	"sale_price_cents" bigint,
	"cost_price_cents" bigint,
	"reorder_level" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "products_id_shop_unique" UNIQUE("id","shop_id"),
	CONSTRAINT "products_non_negative" CHECK (coalesce("products"."sale_price_cents", 0) >= 0 and coalesce("products"."cost_price_cents", 0) >= 0 and coalesce("products"."reorder_level", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_shop_idx" ON "products" USING btree ("shop_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_product_same_shop_fk" FOREIGN KEY ("product_id","shop_id") REFERENCES "public"."products"("id","shop_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_shop_product_idx" ON "ledger_entries" USING btree ("shop_id","product_id");