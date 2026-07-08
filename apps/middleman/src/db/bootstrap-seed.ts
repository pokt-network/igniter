import { eq } from 'drizzle-orm'
import * as fs from 'fs'
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing'
import * as schema from '@igniter/db/middleman/schema'
import { UserRole, ProviderFee } from '@igniter/db/middleman/enums'
import { setup } from '@igniter/db/connection'
import { configureLogging, getLogger } from '@igniter/logger'

const { usersTable, applicationSettingsTable, providersTable } = schema

interface BootstrapConfig {
  settings: {
    name: string
    supportEmail?: string
    ownerEmail: string
    fee: number
    delegatorRewardsAddress: string
    privacyPolicy?: string
    pocketApiUrl?: string
    pocketRpcUrl?: string
    rpcUrl?: string // backward compat: old field name, used as pocketApiUrl fallback
    indexerApiUrl: string
    chainId: string
  }
}

interface CdnProvider {
  name: string
  identity: string
  identityHistory?: string[]
  url: string
}

async function main() {
  // Without this, every getLogger() call in this seed writes to a logger with no
  // configured sinks (blackhole). Wire the standard config so seed logs surface.
  await configureLogging({ serviceName: 'middleman' })

  const configPath = process.env.BOOTSTRAP_CONFIG_PATH
  if (!configPath) {
    console.log('[bootstrap-seed] BOOTSTRAP_CONFIG_PATH not set, skipping.')
    process.exit(0)
  }

  if (!fs.existsSync(configPath)) {
    console.log(`[bootstrap-seed] Config file not found at ${configPath}, skipping.`)
    process.exit(0)
  }

  const ownerIdentity = process.env.OWNER_IDENTITY
  if (!ownerIdentity) {
    console.error('[bootstrap-seed] OWNER_IDENTITY is required.')
    process.exit(1)
  }

  const ownerEmail = process.env.OWNER_EMAIL
  const appIdentityPrivateKey = process.env.APP_IDENTITY
  if (!appIdentityPrivateKey) {
    console.error('[bootstrap-seed] APP_IDENTITY is required.')
    process.exit(1)
  }

  // Derive compressed public key from APP_IDENTITY private key
  const privateKeyBytes = Buffer.from(appIdentityPrivateKey, 'hex')
  const wallet = await DirectSecp256k1Wallet.fromKey(privateKeyBytes)
  const [account] = await wallet.getAccounts()
  if (!account) {
    console.error('[bootstrap-seed] Failed to derive public key from APP_IDENTITY.')
    process.exit(1)
  }
  const appIdentity = Buffer.from(account.pubkey).toString('hex')

  const logger = getLogger()
  const { db, disconnect } = setup({ schema, logger })

  try {
    // Check if already bootstrapped
    const existing = await db
      .select({ isBootstrapped: applicationSettingsTable.isBootstrapped })
      .from(applicationSettingsTable)
      .limit(1)

    if (existing.length > 0 && existing[0].isBootstrapped) {
      console.log('[bootstrap-seed] Already bootstrapped, skipping.')
      process.exit(0)
    }

    const config: BootstrapConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    console.log('[bootstrap-seed] Starting bootstrap...')

    // Resolve URLs with backward compat (old configs use rpcUrl for what is now pocketApiUrl)
    const pocketApiUrl = config.settings.pocketApiUrl || config.settings.rpcUrl || ''
    const pocketRpcUrl = config.settings.pocketRpcUrl || ''

    if (!pocketApiUrl) {
      throw new Error('Bootstrap config missing pocketApiUrl (or rpcUrl for backward compat)')
    }

    // Step 0: Fetch blockchain params from API (minimumStake + current height)
    const rpcBase = pocketApiUrl.replace(/\/$/, '')
    const stakeBuffer = parseInt(process.env.MINIMUM_STAKE_BUFFER || '0', 10)
    let minimumStake = 0
    let updatedAtHeight = '0'

    try {
      const supplierParamsUrl = `${rpcBase}/pokt-network/poktroll/supplier/params`
      console.log(`[bootstrap-seed] Fetching minimum stake from ${supplierParamsUrl}...`)
      const paramsResponse = await fetch(supplierParamsUrl)
      if (!paramsResponse.ok) throw new Error(`Supplier params: HTTP ${paramsResponse.status}`)
      const paramsData = await paramsResponse.json()
      const rawAmount = parseFloat(paramsData.params.min_stake.amount)
      minimumStake = (rawAmount + stakeBuffer) / 1e6
      console.log(`[bootstrap-seed] Minimum stake: ${minimumStake} POKT (raw: ${rawAmount}, buffer: ${stakeBuffer})`)

      const statusUrl = `${rpcBase}/cosmos/base/node/v1beta1/status`
      console.log(`[bootstrap-seed] Fetching current height from ${statusUrl}...`)
      const statusResponse = await fetch(statusUrl)
      if (!statusResponse.ok) throw new Error(`Node status: HTTP ${statusResponse.status}`)
      const statusData = await statusResponse.json()
      updatedAtHeight = statusData.height
      console.log(`[bootstrap-seed] Current height: ${updatedAtHeight}`)
    } catch (err) {
      console.error('[bootstrap-seed] Failed to fetch blockchain params:', err)
      process.exit(1)
    }

    // Step 1: Create owner user
    const resolvedOwnerEmail = config.settings.ownerEmail || ownerEmail || ''
    await db
      .insert(usersTable)
      .values({
        identity: ownerIdentity,
        email: resolvedOwnerEmail,
        role: UserRole.Owner,
      })
      .onConflictDoNothing({ target: usersTable.identity })

    console.log('[bootstrap-seed] Owner user created.')

    // Step 2: Insert application settings (not yet bootstrapped)
    if (existing.length === 0) {
      await db.insert(applicationSettingsTable).values({
        name: config.settings.name,
        appIdentity,
        supportEmail: config.settings.supportEmail ?? resolvedOwnerEmail,
        ownerEmail: resolvedOwnerEmail,
        ownerIdentity,
        fee: config.settings.fee,
        minimumStake,
        isBootstrapped: false,
        chainId: config.settings.chainId,
        delegatorRewardsAddress: config.settings.delegatorRewardsAddress || ownerIdentity,
        pocketApiUrl,
        pocketRpcUrl,
        indexerApiUrl: config.settings.indexerApiUrl,
        updatedAtHeight,
        privacyPolicy: config.settings.privacyPolicy ?? null,
        createdBy: ownerIdentity,
        updatedBy: ownerIdentity,
      })
    }

    console.log('[bootstrap-seed] Application settings created.')

    // Step 3: Fetch providers from CDN and insert them
    const providersCdnUrl = process.env.PROVIDERS_CDN_URL
    if (providersCdnUrl) {
      const resolvedUrl = providersCdnUrl.replace('{chainId}', config.settings.chainId)
      console.log(`[bootstrap-seed] Fetching providers from ${resolvedUrl}...`)
      try {
        const response = await fetch(resolvedUrl)
        if (!response.ok) {
          console.warn(`[bootstrap-seed] Failed to fetch providers (${response.status}), skipping.`)
        } else {
          const cdnProviders: CdnProvider[] = await response.json()
          for (const provider of cdnProviders) {
            await db
              .insert(providersTable)
              .values({
                name: provider.name,
                identity: provider.identity,
                url: provider.url,
                enabled: true,
                visible: true,
                fee: 0,
                feeType: ProviderFee.UpTo,
                minimumStake: 0,
                operationalFunds: 5,
                allowPublicStaking: false,
                createdBy: ownerIdentity,
                updatedBy: ownerIdentity,
              })
              .onConflictDoNothing({ target: providersTable.identity })

            console.log(`[bootstrap-seed] Provider "${provider.name}" created.`)
          }
        }
      } catch (err) {
        console.warn('[bootstrap-seed] Error fetching providers, skipping:', err)
      }
    } else {
      console.log('[bootstrap-seed] PROVIDERS_CDN_URL not set, skipping providers.')
    }

    // Step 4: Mark as bootstrapped
    await db
      .update(applicationSettingsTable)
      .set({ isBootstrapped: true, updatedBy: ownerIdentity })
      .where(eq(applicationSettingsTable.isBootstrapped, false))

    console.log('[bootstrap-seed] Bootstrap complete!')
  } catch (error) {
    console.error('[bootstrap-seed] Error:', error)
    process.exit(1)
  } finally {
    await disconnect()
  }
}

main()
