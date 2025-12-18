ALTER TABLE "providers" ADD COLUMN "allowPublicStaking" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "allowedStakers" varchar[] DEFAULT '{}';