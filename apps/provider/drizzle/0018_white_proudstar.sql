ALTER TABLE "transactions" ADD COLUMN "last_covered_height" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "tx_verification_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "supplier_verification_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "unavailable_checks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "last_verification_at" timestamp;