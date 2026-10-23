-- Failure-effects outbox: the CAS that fails a row also records the release and notice it owes, in
-- the same UPDATE; TransactionFailureEffects carries them out. The give-up and broadcast-rejection
-- CASes write it for every tx type (a row with no release owed, e.g. any non-Stake row, goes
-- straight to done); only the verifier's failure CAS is Stake-only. All three columns are NULL for
-- existing rows (nothing owed), so there is no backfill and both CHECKs hold on every row.
--
-- Two migrators may apply this at once (see 0020): the self-conflicting lock makes the second wait
-- for the first to commit, and the IF NOT EXISTS checks then let it pass. (Here the first ADD COLUMN
-- would serialize them too; the lock keeps that true if the statements are ever reordered.)
LOCK TABLE "transactions" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "failureEffects" varchar;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "failureReleaseAddresses" jsonb;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "failureNotifiedAt" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"transactions"'::regclass AND conname = 'transactions_failure_effects_value') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_failure_effects_value" CHECK ("transactions"."failureEffects" IN ('pending', 'releasing', 'done', 'manual'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"transactions"'::regclass AND conname = 'transactions_failure_release_addresses_array') THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_failure_release_addresses_array" CHECK ("transactions"."failureReleaseAddresses" IS NULL OR jsonb_typeof("transactions"."failureReleaseAddresses") = 'array');
  END IF;
END $$;
