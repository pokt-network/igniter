-- Dedup nodes by address before adding the unique constraint (#296/#297 root fix).
-- Canonical node per address = freshest data: highest "lastUpdatedHeight"
-- (NULLS LAST), tie-break highest "id". 1) re-point links to canonical where no
-- collision; 2) drop the remaining duplicate links; 3) delete duplicate nodes.
WITH canonical AS (
  SELECT DISTINCT ON ("address") "address", "id" AS keep_id
  FROM "nodes" ORDER BY "address", "lastUpdatedHeight" DESC NULLS LAST, "id" DESC
), dupes AS (
  SELECT n."id" AS dup_id, c.keep_id
  FROM "nodes" n JOIN canonical c ON c."address" = n."address"
  WHERE n."id" <> c.keep_id
)
UPDATE "transactions_to_nodes" t
SET "nodeId" = d.keep_id
FROM dupes d
WHERE t."nodeId" = d.dup_id
  AND NOT EXISTS (
    SELECT 1 FROM "transactions_to_nodes" x
    WHERE x."transactionId" = t."transactionId" AND x."nodeId" = d.keep_id
  );--> statement-breakpoint
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
