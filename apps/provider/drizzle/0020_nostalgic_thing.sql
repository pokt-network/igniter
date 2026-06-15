ALTER TABLE "transactions" ADD COLUMN "signed_payload" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "timeout_timestamp" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "params" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reasons" text;