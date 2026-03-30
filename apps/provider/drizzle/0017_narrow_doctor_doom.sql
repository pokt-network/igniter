ALTER TABLE "application_settings" RENAME COLUMN "rpcUrl" TO "pocketApiUrl";
ALTER TABLE "application_settings" ADD COLUMN "pocketRpcUrl" varchar;