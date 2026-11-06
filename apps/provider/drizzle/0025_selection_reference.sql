CREATE TABLE "analytics_selection_reference_day" (
	"day" date PRIMARY KEY NOT NULL,
	"version" varchar(32) NOT NULL,
	"fetched_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_selection_reference" (
	"day" date NOT NULL,
	"service_id" varchar(255) NOT NULL,
	"height" bigint NOT NULL,
	"candidates" integer NOT NULL,
	"cap" integer NOT NULL,
	"own_eligible" integer NOT NULL,
	"version" varchar(32) NOT NULL,
	"fetched_at" timestamp NOT NULL,
	CONSTRAINT "analytics_selection_reference_day_service_id_pk" PRIMARY KEY("day","service_id")
);
