ALTER TABLE "shops" ADD COLUMN "demo_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "shops_demo_expires_idx" ON "shops" USING btree ("demo_expires_at") WHERE "shops"."demo_expires_at" is not null;--> statement-breakpoint
-- The ledger and audit log stay append-only, with one exception: an expired
-- "Try the demo" sandbox is purged whole (server/demo/purge.ts). A real
-- shop (demo_expires_at null) can never have a row deleted.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM shops
    WHERE id = OLD.shop_id AND demo_expires_at IS NOT NULL AND demo_expires_at <= now()
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only; insert a reversal instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- A real shop can never be turned into a demo (and so made deletable).
CREATE OR REPLACE FUNCTION forbid_demo_flag_change() RETURNS trigger AS $$
BEGIN
  IF NEW.demo_expires_at IS DISTINCT FROM OLD.demo_expires_at THEN
    RAISE EXCEPTION 'shops.demo_expires_at is set once, when a demo shop is created';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER shops_demo_flag_fixed
  BEFORE UPDATE OF demo_expires_at ON shops
  FOR EACH ROW EXECUTE FUNCTION forbid_demo_flag_change();
