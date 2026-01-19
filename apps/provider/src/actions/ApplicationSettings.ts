'use server'

import type { ApplicationSettings } from '@igniter/db/provider/schema'
import { ChainId } from '@igniter/db/provider/enums'
import {
  getApplicationSettings as fetchApplicationSettings,
  insertApplicationSettings,
  updateApplicationSettings,
} from '@/lib/dal/applicationSettings'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import urlJoin from 'url-join'
import { getServerApolloClient } from '@igniter/ui/graphql/server'
import { indexerStatusDocument } from '@igniter/graphql'
import { env } from '@/config/env'
import {
  revalidateTag,
  unstable_cache,
} from 'next/cache'
import {
  type ActionResult,
  withRequireOwner,
} from '@/lib/utils/actionUtils'

const UrlSchema = z.string().url('Please enter a valid URL').min(1, 'URL is required')

const UpdateSettingsSchema = z.object({
  name: z.string().optional(),
  appIdentity: z.string().min(1, 'App identity is required').optional(),
  supportEmail: z.string().email().optional(),
  ownerEmail: z.string().email().optional(),
  rpcUrl: UrlSchema.optional(),
  indexerApiUrl: UrlSchema.optional(),
  minimumStake: z.number().optional(),
  updatedAtHeight: z.string().optional(),
})

const CreateSettingsSchema = z.object({
  minimumStake: z.number().min(1),
  rpcUrl: UrlSchema,
  indexerApiUrl: UrlSchema,
  appIdentity: z.string().min(1, 'App identity is required'),
  chainId: z.nativeEnum(ChainId),
  updatedAtHeight: z.string(),
})

const appSettingsCacheTag = 'appSettings';

const getAppSettings = unstable_cache(
  async () => {
    return await fetchApplicationSettings()
  },
  undefined,
  { tags: [appSettingsCacheTag] },
)

// Public endpoint - no auth required (used for app name display)
export async function GetAppName() {
  let appSettings = await getAppSettings()

  if (!appSettings) {
    appSettings = await fetchApplicationSettings()
  }

  return appSettings?.name || 'Stake Igniter Provider'
}

// Public endpoint - no auth required (used during bootstrap)
export async function GetApplicationSettings() {
  const appSettings = await getAppSettings()

  if (appSettings) return appSettings

  return await fetchApplicationSettings()
}

function ValidateWithSchema(schema: z.ZodSchema<any>, data: Partial<ApplicationSettings>) {
  const validation = schema.safeParse(data)

  if (!validation.success) {
    throw new Error(validation.error.message)
  }

  return validation
}

export async function UpsertApplicationSettings(
  values: Partial<ApplicationSettings>,
  isUpdate: boolean,
): Promise<ActionResult<void>> {
  return withRequireOwner(async (user) => {
    const validatedFields = ValidateWithSchema(isUpdate ? UpdateSettingsSchema : CreateSettingsSchema, values)

    if (isUpdate) {
      await updateApplicationSettings({
        ...validatedFields.data,
        updatedBy: user.identity,
      })
    } else {
      await insertApplicationSettings({
        ...validatedFields.data,
        createdBy: user.identity,
        updatedBy: user.identity,
      })
    }

    revalidateTag(appSettingsCacheTag)
  })
}

export async function completeSetup(): Promise<ActionResult<never>> {
  return withRequireOwner(async (user) => {
    await updateApplicationSettings({ isBootstrapped: true, updatedBy: user.identity })
    redirect('/admin')
  })
}

export interface BlockchainSettingsResponse {
  success: boolean;
  errors?: string[];
  network?: string;
  height?: string;
  minStake?: number;
}

export async function RetrieveBlockchainSettings(url: string, updatedAtHeight: string | null): Promise<BlockchainSettingsResponse> {
  const errors: string[] = []
  const supplierParamsUrl = urlJoin(url, 'pokt-network/poktroll/supplier/params')
  const supplierParamsResponse = await fetch(supplierParamsUrl)

  if (!supplierParamsResponse.ok) {
    throw new Error('Failed to fetch supplier params')
  }

  const supplierParams = await supplierParamsResponse.json()
  const minStake = (parseFloat(supplierParams.params.min_stake.amount) + env.MINIMUM_STAKE_BUFFER) / 1e6

  const nodeInfoUrl = urlJoin(url, 'cosmos/base/tendermint/v1beta1/node_info')
  const nodeInfoResponse = await fetch(nodeInfoUrl)

  if (!nodeInfoResponse.ok) {
    throw new Error('Failed to fetch node info')
  }

  const nodeInfo = await nodeInfoResponse.json()
  const network = nodeInfo.default_node_info.network

  const statusUrl = urlJoin(url, 'cosmos/base/node/v1beta1/status')
  const statusResponse = await fetch(statusUrl)

  if (!statusResponse.ok) {
    throw new Error('Failed to fetch chain status (height)')
  }

  const statusResult = await statusResponse.json()
  const newHeightStr: string = statusResult.height
  const newHeight = parseInt(newHeightStr, 10)

  if (updatedAtHeight) {
    if (Number(newHeight) < Number(updatedAtHeight)) {
      errors.push(`Retrieved height (${newHeight}) is lower than the current stored height (${updatedAtHeight}).`)
      return {
        success: false,
        errors,
      }
    }
  }

  return {
    success: true,
    errors,
    network,
    height: newHeightStr,
    minStake,
  }
}

export interface ValidateBlockchainRPCResponse {
  success: boolean;
  errors?: string[];
}

export async function ValidateBlockchainRPC(url: string): Promise<ValidateBlockchainRPCResponse> {
  const currentSettings = await GetApplicationSettings()
  const { success, network, errors } = await RetrieveBlockchainSettings(url, currentSettings.updatedAtHeight)
  if (!success) {
    return {
      success: false,
      errors,
    }
  }

  if (network !== currentSettings.chainId) {
    return {
      success: false,
      errors: ['Chain does not match the current configured chain'],
    }
  }

  return {
    success: true,
  }
}

export async function RetrieveIndexerNetwork(url: string) {
  const client = getServerApolloClient(url)

  const { data } = await client.query({
    query: indexerStatusDocument,
  })

  return data?.status?.chain || ''
}

export async function ValidateIndexerUrl(url: string) {
  const [currentSettings, indexerNetwork] = await Promise.all([
    GetApplicationSettings(),
    RetrieveIndexerNetwork(url),
  ])

  if (currentSettings.chainId !== indexerNetwork) {
    return {
      success: false,
      errors: ['Chain does not match the current configured chain'],
    }
  }

  return {
    success: true,
  }
}
