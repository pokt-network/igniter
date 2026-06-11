-- Adopt in-flight broadcast txs into the verifier: start the incremental hash
-- scan from the broadcast height instead of 0. Existing `failure` rows are left
-- untouched (already remediated by the #296/#297 live patch).
UPDATE "transactions"
SET "lastCoveredHeight" = "executionHeight"
WHERE "status" = 'pending'
  AND "hash" IS NOT NULL
  AND "lastCoveredHeight" IS NULL
  AND "executionHeight" IS NOT NULL;
