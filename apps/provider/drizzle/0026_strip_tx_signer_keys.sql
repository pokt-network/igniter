-- transactions.params no longer stores the decrypted signer private key
-- (`signerPrivateKey`, at the top level for legacy untagged stake intents and under
-- `params` for tagged intents). The worker loads the key from the keys table at sign
-- time, so strip it from every existing row. A row whose params is not valid JSON but
-- still contains the key string is nulled rather than left in place.
--
-- Workflow inputs are no longer trusted to choose a return-funds destination. A pending
-- unstake intent with a `custom` destination that came from a workflow input and is not
-- yet signed is failed here, so it is never signed; the owner re-issues the unstake from
-- the provider app, which writes the intent itself. Rows already signed (signed_payload
-- set) are left for the operator to inspect: the signed bytes are final.
UPDATE "transactions"
  SET "status" = 'failure',
      "message" = 'cancelled by migration 0026: custom return-funds destination from a workflow input'
  WHERE "type" = 'unstake'
    AND "status" = 'pending'
    AND "signed_payload" IS NULL
    AND "params" LIKE '%"mode":%"custom"%';
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT "id", "params" FROM "transactions" WHERE "params" LIKE '%signerPrivateKey%' LOOP
    BEGIN
      UPDATE "transactions"
        SET "params" = ((r."params"::jsonb - 'signerPrivateKey') #- '{params,signerPrivateKey}')::text
        WHERE "id" = r."id";
    EXCEPTION WHEN invalid_text_representation THEN
      UPDATE "transactions" SET "params" = NULL WHERE "id" = r."id";
    END;
  END LOOP;
END $$;
--> statement-breakpoint
-- Final sweep: no row may keep the key under any other JSON shape. A pending row is failed
-- (the owner re-issues it; the worker loads the key itself), and every remaining match is nulled.
UPDATE "transactions"
  SET "status" = 'failure',
      "message" = 'cancelled by migration 0026: params held a signer private key in an unexpected shape'
  WHERE "params" LIKE '%signerPrivateKey%' AND "status" = 'pending';
--> statement-breakpoint
UPDATE "transactions" SET "params" = NULL WHERE "params" LIKE '%signerPrivateKey%';
