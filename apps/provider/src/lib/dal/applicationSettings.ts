import type {
  ApplicationSettings,
  InsertApplicationSettings,
} from '@igniter/db/provider/schema'
import 'server-only'
import { getDbClient } from '@/db'
import { ChainId } from '@igniter/db/provider/enums'
import { applicationSettingsTable } from '@igniter/db/provider/schema'
import { eq } from 'drizzle-orm'
import { getCompressedPublicKeyFromAppIdentity } from '@igniter/commons/crypto'
import { env } from '@/config/env'

const defaultSettings: ApplicationSettings = {
  id: 0,
  name: '',
  indexerApiUrl: '',
  appIdentity: '',
  supportEmail: '',
  ownerIdentity: '',
  ownerEmail: '',
  pocketApiUrl: '',
  pocketRpcUrl: '',
  chainId: ChainId.Pocket,
  minimumStake: 0,
  isBootstrapped: false,
  createdBy: '',
  updatedBy: '',
  updatedAtHeight: '',
  createdAt: new Date(),
  updatedAt: new Date(),
}

export async function getApplicationSettings(): Promise<ApplicationSettings> {
  const dbSettings = await getApplicationSettingsFromDatabase()
  const appIdentity = await getCompressedPublicKeyFromAppIdentity()

  const envSettings = {
    chainId: process.env.CHAIN_ID as ChainId,
    ownerIdentity: env.OWNER_IDENTITY,
    ownerEmail: process.env.OWNER_EMAIL!,
    appIdentity: appIdentity.toString('hex'),
  }

  return {
    ...defaultSettings,
    ...envSettings,
    ...(dbSettings ?? {}),
  }
}

export async function getApplicationSettingsFromDatabase() {
  const dbClient = getDbClient()
  return dbClient.db.query.applicationSettingsTable.findFirst()
}

export async function insertApplicationSettings(
  settings: Omit<InsertApplicationSettings, 'ownerIdentity' | 'isBootstrapped'>,
): Promise<ApplicationSettings> {
  const dbClient = getDbClient()
  const insertedSettings = await dbClient.db
    .insert(applicationSettingsTable)
    .values({
      ...settings,
      ownerIdentity: env.OWNER_IDENTITY,
      isBootstrapped: false,
    })
    .returning()
    .then((res) => res[0])

  if (!insertedSettings) {
    throw new Error('Failed to insert application settings')
  }

  return insertedSettings
}

export async function updateApplicationSettings(
  settings: Partial<ApplicationSettings>,
): Promise<ApplicationSettings> {
  const existingSettings = await getApplicationSettingsFromDatabase()
  if (!existingSettings?.id) {
    throw new Error('No existing settings found to update')
  }
  const dbClient = getDbClient()
  const updatedSettings = await dbClient.db
    .update(applicationSettingsTable)
    .set(settings)
    .where(eq(applicationSettingsTable.id, existingSettings.id))
    .returning()
    .then((res) => res[0])

  if (!updatedSettings) {
    throw new Error('Failed to update application settings')
  }

  return updatedSettings
}

export async function isAppBootstrapped() {
  const settings = await getApplicationSettingsFromDatabase()
  return settings?.isBootstrapped ?? false
}
