CREATE TYPE "public"."import_attempt_status" AS ENUM('initiated', 'signed', 'submitted', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "import_supplier_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_supplier_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userIdentity" varchar(255) NOT NULL,
	"ownerAddress" varchar(255) NOT NULL,
	"providerIdentity" varchar(255) NOT NULL,
	"providerId" integer,
	"nonce" varchar(255),
	"status" "import_attempt_status" DEFAULT 'initiated' NOT NULL,
	"importedSupplierAddresses" json DEFAULT '[]'::json,
	"errorMessage" varchar(1024),
	"createdAt" timestamp DEFAULT now(),
	"signedAt" timestamp,
	"submittedAt" timestamp,
	"completedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "import_supplier_attempts" ADD CONSTRAINT "import_supplier_attempts_userIdentity_users_identity_fk" FOREIGN KEY ("userIdentity") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_supplier_attempts" ADD CONSTRAINT "import_supplier_attempts_providerId_providers_id_fk" FOREIGN KEY ("providerId") REFERENCES "public"."providers"("id") ON DELETE no action ON UPDATE no action;