ALTER TABLE "nodes" ADD COLUMN "services" jsonb DEFAULT '[]'::jsonb;
