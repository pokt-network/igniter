ALTER TABLE "transactions" ADD COLUMN "timeoutHeight" integer;--> statement-breakpoint
CREATE INDEX "mw_transactions_verifier_sweep_idx" ON "transactions" USING btree ("status","lastVerificationAt") WHERE "hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "txVerificationAttempts";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "supplierVerificationAttempts";