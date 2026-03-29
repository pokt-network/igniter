CREATE TYPE "public"."tx_status" AS ENUM('pending', 'success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."tx_trigger" AS ENUM('manual', 'automatic');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('stake', 'unstake');--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key_id" integer,
	"key_address" varchar(255) NOT NULL,
	"type" "tx_type" NOT NULL,
	"status" "tx_status" NOT NULL,
	"reason" varchar(10),
	"trigger" "tx_trigger",
	"hash" varchar(64),
	"code" integer,
	"message" text,
	"execution_height" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_key_id_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."keys"("id") ON DELETE no action ON UPDATE no action;