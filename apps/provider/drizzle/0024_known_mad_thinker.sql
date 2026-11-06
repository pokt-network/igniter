CREATE TABLE "analytics_day_rollup" (
	"day" date PRIMARY KEY NOT NULL,
	"version" varchar(32) NOT NULL,
	"built_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_owner_day" (
	"day" date NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"owner_address" varchar(255) NOT NULL,
	"sessions" integer NOT NULL,
	CONSTRAINT "analytics_owner_day_day_service_id_owner_address_pk" PRIMARY KEY("day","service_id","owner_address")
);
--> statement-breakpoint
CREATE TABLE "analytics_service_day" (
	"day" date NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"network_sessions" bigint,
	"fetched_at" timestamp NOT NULL,
	CONSTRAINT "analytics_service_day_day_service_id_pk" PRIMARY KEY("day","service_id")
);
--> statement-breakpoint
CREATE TABLE "analytics_session_member" (
	"session_id" varchar(255) NOT NULL,
	"supplier_id" varchar(255) NOT NULL,
	"day" date NOT NULL,
	"state" varchar(32) NOT NULL,
	"paid_upokt" numeric,
	"equal_share_upokt" numeric,
	"fetched_at" timestamp NOT NULL,
	CONSTRAINT "analytics_session_member_session_id_supplier_id_pk" PRIMARY KEY("session_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "analytics_session" (
	"session_id" varchar(255) PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"application_id" varchar(255) NOT NULL,
	"start_height" bigint NOT NULL,
	"phase" varchar(32) NOT NULL,
	"money_missing" boolean NOT NULL,
	"paid_upokt" numeric,
	"roster_size" bigint,
	"candidates" bigint,
	"fetched_at" timestamp NOT NULL,
	"own_members" integer,
	"own_paid_upokt" numeric,
	"own_equal_share_upokt" numeric
);
--> statement-breakpoint
CREATE TABLE "analytics_supplier_day_state" (
	"day" date NOT NULL,
	"supplier_id" varchar(255) NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"covered_to" timestamp,
	"fetched_at" timestamp NOT NULL,
	CONSTRAINT "analytics_supplier_day_state_day_supplier_id_pk" PRIMARY KEY("day","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "analytics_supplier_day" (
	"day" date NOT NULL,
	"supplier_id" varchar(255) NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"seats" bigint,
	"paid" bigint,
	"settled_zero" bigint,
	"expired" bigint,
	"discarded" bigint,
	"slashed" bigint,
	"idle_others_worked" bigint,
	"idle_no_work" bigint,
	"unresolved" bigint,
	"active" bigint,
	"paid_upokt" numeric,
	"equal_share_upokt" numeric,
	"relays" numeric,
	"compute_units" numeric,
	"sessions_with_selected" bigint,
	"pool_upokt" numeric,
	"roster_seats" bigint,
	"first_height" bigint,
	"last_height" bigint,
	"fetched_at" timestamp NOT NULL,
	CONSTRAINT "analytics_supplier_day_day_supplier_id_service_id_pk" PRIMARY KEY("day","supplier_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "application_settings" ADD COLUMN "analytics_day_retention_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
CREATE INDEX "analytics_session_member_supplier_day_idx" ON "analytics_session_member" USING btree ("supplier_id","day");--> statement-breakpoint
CREATE INDEX "analytics_session_member_day_idx" ON "analytics_session_member" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_session_day_idx" ON "analytics_session" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_session_start_height_idx" ON "analytics_session" USING btree ("start_height","session_id");--> statement-breakpoint
CREATE INDEX "analytics_supplier_day_supplier_day_idx" ON "analytics_supplier_day" USING btree ("supplier_id","day");