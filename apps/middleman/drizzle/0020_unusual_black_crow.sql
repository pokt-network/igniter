-- Forbid blank payloads (tx 519 on mainnet was stored with signedPayload = '').
--
-- NOT VALID: existing rows are not checked or rewritten (on mainnet only row 519, already
-- failed, is blank); every insert and update from now on is.
--
-- The middleman and middleman-workflows pods both run this migrator as an initContainer with no
-- lock between them, so two runs can apply this migration at once. The self-conflicting lock makes
-- the second wait for the first to commit, and the IF NOT EXISTS checks then let it pass. The
-- deploy-level fix (a single migrator) is tracked separately.
LOCK TABLE "transactions" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"transactions"'::regclass AND conname = 'transactions_signed_payload_not_empty') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_signed_payload_not_empty" CHECK (btrim("transactions"."signedPayload") <> '') NOT VALID;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"transactions"'::regclass AND conname = 'transactions_unsigned_payload_not_empty') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_unsigned_payload_not_empty" CHECK (btrim("transactions"."unsignedPayload") <> '') NOT VALID;
  END IF;
END $$;
