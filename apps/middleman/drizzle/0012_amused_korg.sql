ALTER TABLE "transactions" ADD COLUMN "lastCoveredHeight" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "txVerificationAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "supplierVerificationAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "unavailableChecks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "lastVerificationAt" timestamp;