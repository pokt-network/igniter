CREATE TYPE "public"."supplier_change_type" AS ENUM('service_added', 'service_removed', 'rev_share_changed');--> statement-breakpoint
CREATE TABLE "supplier_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nodeId" integer NOT NULL,
	"changeType" "supplier_change_type" NOT NULL,
	"serviceId" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"batchId" varchar(255) NOT NULL,
	"acknowledgedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_changes" ADD CONSTRAINT "supplier_changes_nodeId_nodes_id_fk" FOREIGN KEY ("nodeId") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;