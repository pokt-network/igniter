CREATE TYPE "public"."notification_channel_type" AS ENUM('discord', 'telegram', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_event_type" AS ENUM('service_change', 'revshare_change', 'stake', 'unstake', 'upstake', 'operational_funds', 'import_result');--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL,
	"type" "notification_channel_type" NOT NULL,
	"config" text NOT NULL,
	"notificationFlags" json DEFAULT '{"service_change":true,"revshare_change":true,"stake":true,"unstake":true,"upstake":true,"operational_funds":true,"import_result":true}'::json NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"createdBy" varchar(255) NOT NULL,
	"updatedAt" timestamp DEFAULT now(),
	"updatedBy" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"type" "notification_event_type" NOT NULL,
	"createdBy" varchar(255) NOT NULL,
	"metadata" json,
	"channels" json DEFAULT '[]'::json NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"viewedAt" timestamp,
	CONSTRAINT "notification_events_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"userIdentity" varchar(255) PRIMARY KEY NOT NULL,
	"inAppFeedEnabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"updatedAt" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_createdBy_users_identity_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_updatedBy_users_identity_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_createdBy_users_identity_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userIdentity_users_identity_fk" FOREIGN KEY ("userIdentity") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;