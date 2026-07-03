ALTER TABLE "watchdog_heal_state" ADD COLUMN "recreations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "watchdog_heal_state" ADD COLUMN "last_recreated_at" timestamp;