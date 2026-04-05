import "server-only";
import { cache } from "react";
import { getDb } from "@/db";
import {
  ApplicationSettings,
  applicationSettingsTable,
  InsertApplicationSettings,
} from "@igniter/db/middleman/schema";
import {ChainId} from '@igniter/db/middleman/enums'
import { eq } from "drizzle-orm";
import {getCompressedPublicKeyFromAppIdentity} from "@igniter/commons/crypto";
import {env} from "@/config/env";

const defaultSettings: ApplicationSettings = {
  id: 0,
  name: "",
  supportEmail: "",
  pocketApiUrl: "",
  pocketRpcUrl: "",
  indexerApiUrl: "",
  appIdentity: "",
  ownerEmail: "",
  ownerIdentity: "",
  fee: 1,
  minimumStake: 60000,
  isBootstrapped: false,
  delegatorRewardsAddress: '',
  chainId: ChainId.Pocket,
  privacyPolicy: "",
  createdAt: new Date(),
  createdBy: "",
  updatedAt: new Date(),
  updatedBy: "",
  updatedAtHeight: null
};

/**
 * Per-request cached application settings fetch.
 * React's cache() deduplicates calls within the same server render,
 * so multiple components/actions calling this in one request hit the DB only once.
 */
export const getApplicationSettings = cache(async (): Promise<ApplicationSettings> => {
  const dbSettings = await getApplicationSettingsFromDatabase();
  const appIdentity = await getCompressedPublicKeyFromAppIdentity();

  const envSettings = {
    chainId: process.env.CHAIN_ID as ChainId,
    ownerIdentity: env.OWNER_IDENTITY,
    ownerEmail: process.env.OWNER_EMAIL!,
    appIdentity: appIdentity.toString('hex'),
  };

  return {
    ...defaultSettings,
    ...envSettings,
    ...(dbSettings ?? {}),
  };
});

export async function getApplicationSettingsFromDatabase() {
  return getDb().query.applicationSettingsTable.findFirst();
}

export async function insertApplicationSettings(
  settings: Omit<InsertApplicationSettings, 'ownerIdentity' | 'isBootstrapped'>,
): Promise<ApplicationSettings> {
  const insertedSettings = await getDb()
    .insert(applicationSettingsTable)
    .values({
      ...settings,
      ownerIdentity: env.OWNER_IDENTITY,
      isBootstrapped: false,
    })
    .returning()
    .then((res) => res[0]);

  if (!insertedSettings) {
    throw new Error("Failed to insert application settings");
  }

  return insertedSettings;
}

export async function updateApplicationSettings(
  settings: Partial<ApplicationSettings>
): Promise<ApplicationSettings> {
  const existingSettings = await getApplicationSettingsFromDatabase();

  if (!existingSettings?.id) {
    throw new Error("No existing settings found to update");
  }

  const updatedSettings = await getDb()
    .update(applicationSettingsTable)
    .set(settings)
    .where(eq(applicationSettingsTable.id, existingSettings.id))
    .returning()
    .then((res) => res[0]);

  if (!updatedSettings) {
    throw new Error("Failed to update application settings");
  }

  return updatedSettings;
}


export async function isAppBootstrapped() {
  const settings = await getApplicationSettingsFromDatabase();
  return settings?.isBootstrapped ?? false;
}
