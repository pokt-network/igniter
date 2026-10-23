-- Dispatcher attempt bookkeeping. IF NOT EXISTS: both initContainers may apply this (see 0020).
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "dispatchAttempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "firstDispatchAttemptAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "lastDispatchRunId" varchar(64);
