CREATE TABLE "supplier_deliveries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userIdentity" varchar(255) NOT NULL,
	"providerIdentity" varchar(255) NOT NULL,
	"ownerAddress" varchar(255) NOT NULL,
	"addresses" text[] NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"releasedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_deliveries" ADD CONSTRAINT "supplier_deliveries_userIdentity_users_identity_fk" FOREIGN KEY ("userIdentity") REFERENCES "public"."users"("identity") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_deliveries_user_provider_idx" ON "supplier_deliveries" USING btree ("userIdentity","providerIdentity");