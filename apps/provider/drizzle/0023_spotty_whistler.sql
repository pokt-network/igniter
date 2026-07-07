CREATE TABLE "watchdog_heal_state" (
	"schedule_id" text PRIMARY KEY NOT NULL,
	"unstucks" integer DEFAULT 0 NOT NULL,
	"injected_triggers" integer DEFAULT 0 NOT NULL,
	"last_heal_trigger_at" timestamp,
	"last_action_count" integer DEFAULT 0 NOT NULL,
	"unhealthy" boolean DEFAULT false NOT NULL,
	"observed_unhealthy" boolean DEFAULT false NOT NULL,
	"recreations" integer DEFAULT 0 NOT NULL,
	"last_recreated_at" timestamp
);
