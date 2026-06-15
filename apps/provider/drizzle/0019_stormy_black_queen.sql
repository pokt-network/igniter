ALTER TABLE "transactions" ADD COLUMN "timeout_height" integer;--> statement-breakpoint
CREATE INDEX "transactions_verifier_sweep_idx" ON "transactions" USING btree ("status","last_verification_at") WHERE "hash" IS NOT NULL;--> statement-breakpoint
UPDATE "transactions" t SET "status" = 'failure', "message" = 'superseded duplicate pending (pre-unique-index cleanup)'
WHERE t."status" = 'pending' AND EXISTS (
  SELECT 1 FROM "transactions" n WHERE n."key_id" = t."key_id" AND n."status" = 'pending' AND n."id" > t."id"
);--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_key_pending_uq" ON "transactions" USING btree ("key_id") WHERE status = 'pending';--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "tx_verification_attempts";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "supplier_verification_attempts";