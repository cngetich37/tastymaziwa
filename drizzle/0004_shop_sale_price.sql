ALTER TABLE "shops" ADD COLUMN "sale_price_per_litre_cents" bigint;--> statement-breakpoint
-- Existing shops start from the price of their most recent normal sale (not a
-- subscription or reversal), so attendants can keep selling after the deploy.
UPDATE "shops" SET "sale_price_per_litre_cents" = (
  SELECT "unit_price_cents" FROM "ledger_entries" e
  WHERE e."shop_id" = "shops"."id" AND e."kind" = 'sale'
    AND e."reverses_id" IS NULL AND e."subscription_id" IS NULL AND e."unit_price_cents" > 0
  ORDER BY e."occurred_at" DESC LIMIT 1
);
