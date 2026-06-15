-- Dedup nodes by address before adding the unique constraint (#296/#297 root fix).
-- Canonical node per address = freshest data: highest "lastUpdatedHeight"
-- (NULLS LAST), tie-break highest "id". 1) insert canonical links (DISTINCT +
-- ON CONFLICT, collision-safe even when one tx links two dups of the same
-- address); 2) drop all duplicate links; 3) re-point supplier_changes; 4) delete
-- duplicate nodes; 5) add the unique constraint.
WITH canonical AS (
  SELECT DISTINCT ON ("address") "address", "id" AS keep_id
  FROM "nodes" ORDER BY "address", "lastUpdatedHeight" DESC NULLS LAST, "id" DESC
), dupes AS (
  SELECT n."id" AS dup_id, c.keep_id
  FROM "nodes" n JOIN canonical c ON c."address" = n."address"
  WHERE n."id" <> c.keep_id
)
INSERT INTO "transactions_to_nodes" ("transactionId", "nodeId")
SELECT DISTINCT t."transactionId", d.keep_id
FROM "transactions_to_nodes" t JOIN dupes d ON t."nodeId" = d.dup_id
ON CONFLICT DO NOTHING;--> statement-breakpoint
WITH canonical AS (
  SELECT DISTINCT ON ("address") "address", "id" AS keep_id
  FROM "nodes" ORDER BY "address", "lastUpdatedHeight" DESC NULLS LAST, "id" DESC
), dupes AS (
  SELECT n."id" AS dup_id
  FROM "nodes" n JOIN canonical c ON c."address" = n."address"
  WHERE n."id" <> c.keep_id
)
DELETE FROM "transactions_to_nodes" t USING dupes d WHERE t."nodeId" = d.dup_id;--> statement-breakpoint
WITH canonical AS (
  SELECT DISTINCT ON ("address") "address", "id" AS keep_id
  FROM "nodes" ORDER BY "address", "lastUpdatedHeight" DESC NULLS LAST, "id" DESC
), dupes AS (
  SELECT n."id" AS dup_id, c.keep_id
  FROM "nodes" n JOIN canonical c ON c."address" = n."address"
  WHERE n."id" <> c.keep_id
)
UPDATE "supplier_changes" s SET "nodeId" = d.keep_id FROM dupes d WHERE s."nodeId" = d.dup_id;--> statement-breakpoint
WITH canonical AS (
  SELECT DISTINCT ON ("address") "address", "id" AS keep_id
  FROM "nodes" ORDER BY "address", "lastUpdatedHeight" DESC NULLS LAST, "id" DESC
), dupes AS (
  SELECT n."id" AS dup_id
  FROM "nodes" n JOIN canonical c ON c."address" = n."address"
  WHERE n."id" <> c.keep_id
)
DELETE FROM "nodes" n USING dupes d WHERE n."id" = d.dup_id;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_address_unique" UNIQUE("address");
