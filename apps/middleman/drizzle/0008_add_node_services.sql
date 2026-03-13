ALTER TABLE "nodes" ADD COLUMN IF NOT EXISTS "services" jsonb DEFAULT '[]'::jsonb;
