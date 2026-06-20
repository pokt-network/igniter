ALTER TYPE "public"."tx_type" ADD VALUE 'return_funds';--> statement-breakpoint
ALTER TABLE "application_settings" ADD COLUMN "returnSupplierFundsToOwner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN "retired_at" timestamp;--> statement-breakpoint
UPDATE "keys" SET "retired_at" = now() WHERE "state" = 'unstaked' AND "retired_at" IS NULL;