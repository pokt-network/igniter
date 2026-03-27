ALTER TABLE "keys" ADD COLUMN "exportedAt" timestamp;--> statement-breakpoint
ALTER TABLE "keys" ADD COLUMN "exportCount" integer DEFAULT 0;