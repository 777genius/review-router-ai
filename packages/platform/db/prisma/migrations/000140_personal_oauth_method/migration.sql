-- Browser operations retain NULL and their original normalized intent hash.
-- Only the device method is durable; user codes and provider handoffs stay ephemeral.
BEGIN;
ALTER TABLE "PersonalAccountOperation" ADD COLUMN "oauthMethod" TEXT;
ALTER TABLE "PersonalAccountOperation"
  ADD CONSTRAINT "PersonalAccountOperation_oauth_method_shape" CHECK ((
    "oauthMethod" IS NULL OR
    ("oauthMethod" = 'device_code' AND "action" = 'connect' AND "ingress" = 'oauth-begin')
  ) IS TRUE);

-- Extend immutable intent protection without rewriting the existing lifecycle guard.
CREATE FUNCTION rr_personal_oauth_method_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."oauthMethod" IS DISTINCT FROM OLD."oauthMethod" THEN
    RAISE EXCEPTION 'personal_oauth_method_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PersonalAccountOperation_oauth_method_guard"
  BEFORE UPDATE ON "PersonalAccountOperation"
  FOR EACH ROW EXECUTE FUNCTION rr_personal_oauth_method_guard();
COMMIT;
