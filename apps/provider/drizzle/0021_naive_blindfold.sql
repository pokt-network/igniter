CREATE TYPE "public"."notification_channel_type" AS ENUM('discord', 'telegram', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_event_type" AS ENUM('keys_staked', 'keys_unstaked', 'supplier_funds_low', 'supplier_stake_low', 'remediation_summary', 'delegators_synced');--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notification_channels_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL,
	"type" "notification_channel_type" NOT NULL,
	"config" text NOT NULL,
	"notificationFlags" json DEFAULT '{"keys_staked":true,"keys_unstaked":true,"supplier_funds_low":true,"supplier_stake_low":true,"remediation_summary":true,"delegators_synced":true}'::json NOT NULL,
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
	"metadata" json,
	"channels" json DEFAULT '[]'::json NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"viewedAt" timestamp,
	CONSTRAINT "notification_events_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "smtp_configuration" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "smtp_configuration_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"secure" boolean DEFAULT true NOT NULL,
	"username" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"fromAddress" varchar(255) NOT NULL,
	"fromName" varchar(255),
	"createdAt" timestamp DEFAULT now(),
	"createdBy" varchar(255) NOT NULL,
	"updatedAt" timestamp DEFAULT now(),
	"updatedBy" varchar(255) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_createdBy_users_identity_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_updatedBy_users_identity_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smtp_configuration" ADD CONSTRAINT "smtp_configuration_createdBy_users_identity_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smtp_configuration" ADD CONSTRAINT "smtp_configuration_updatedBy_users_identity_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;