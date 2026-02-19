CREATE TYPE "public"."import_request_status" AS ENUM('pending', 'completed', 'expired', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "import_supplier_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_supplier_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ownerAddress" varchar(255) NOT NULL,
	"delegatorIdentity" varchar(66),
	"nonce" varchar(255) NOT NULL,
	"status" "import_request_status" DEFAULT 'pending' NOT NULL,
	"matchingSupplierAddresses" json DEFAULT '[]'::json,
	"delegatorRevSharePercentage" integer,
	"delegatorRewardsAddress" varchar(255),
	"errorMessage" varchar(1024),
	"createdAt" timestamp DEFAULT now(),
	"completedAt" timestamp,
	"expiresAt" timestamp NOT NULL,
	CONSTRAINT "import_supplier_requests_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
ALTER TABLE "import_supplier_requests" ADD CONSTRAINT "import_supplier_requests_delegatorIdentity_delegators_identity_fk" FOREIGN KEY ("delegatorIdentity") REFERENCES "public"."delegators"("identity") ON DELETE no action ON UPDATE no action;