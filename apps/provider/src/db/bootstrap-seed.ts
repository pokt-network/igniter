import * as schema from '@igniter/db/provider/schema'
import type { NotificationChannelConfig, NotificationFlags } from '@igniter/db/provider/schema'
import { DEFAULT_NOTIFICATION_FLAGS, NotificationChannelType } from '@igniter/db/provider/schema'
import { UserRole } from '@igniter/db/provider/enums'
import { eq } from 'drizzle-orm'
import * as fs from 'fs'
import * as path from 'path'
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing'
import { setup } from '@igniter/db/connection'
import { getLogger } from '@igniter/logger'

const {
  usersTable,
  applicationSettingsTable,
  regionsTable,
  relayMinersTable,
  servicesTable,
  addressGroupTable,
  addressGroupServicesTable,
  delegatorsTable,
  notificationChannelsTable,
} = schema

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BootstrapChannelEntry {
  name: string
  type: 'discord' | 'telegram' | 'email'
  config: NotificationChannelConfig
  notificationFlags?: NotificationFlags
  enabled?: boolean
}

interface BootstrapConfig {
  settings: {
    name: string
    supportEmail?: string
    pocketApiUrl?: string
    pocketRpcUrl?: string
    rpcUrl?: string // backward compat: old field name, used as pocketApiUrl fallback
    indexerApiUrl: string
    chainId: string
    rewardAddresses?: string[]
    initialOperationalFunds?: number
    minimumOperationalFunds?: number
    returnSupplierFundsToOwner?: boolean
  }
  regions: Array<{ displayName: string; urlValue: string }>
  relayMiners: Array<{
    name: string
    identity: string
    regionName: string
    domain: string
  }>
  services: Array<{
    serviceId: string
    name: string
    ownerAddress?: string
    computeUnits?: number
    revSharePercentage?: number
    endpoints: Array<{
      url: string
      rpcType: number
      configs?: Array<{ key: string; value: string }>
    }>
  }>
  addressGroups: Array<{
    name: string
    relayMinerName: string
    private?: boolean
    linkedAddresses?: string[]
    services: Array<{
      serviceId: string
      addSupplierShare?: boolean
      supplierShare?: number
      revShare?: Array<{ address: string; share: number }>
    }>
  }>
  channels?: BootstrapChannelEntry[]
}

interface CdnDelegator {
  name: string
  identity: string
  identityHistory?: string[]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const configPath = process.env.BOOTSTRAP_CONFIG_PATH
  if (!configPath) {
    console.log('[bootstrap-seed] BOOTSTRAP_CONFIG_PATH not set, skipping.')
    process.exit(0)
  }

  const resolvedPath = path.resolve(configPath)
  if (!fs.existsSync(resolvedPath)) {
    console.log(`[bootstrap-seed] Config file not found at ${resolvedPath}, skipping.`)
    process.exit(0)
  }

  const ownerIdentity = process.env.OWNER_IDENTITY
  if (!ownerIdentity) {
    console.error('[bootstrap-seed] OWNER_IDENTITY is required.')
    process.exit(1)
  }

  const ownerEmail = process.env.OWNER_EMAIL || undefined

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

  // Connect to DB
  const logger = getLogger()
  const { db, disconnect } = setup({ schema, logger })

  try {
    // Check if already bootstrapped
    const existingSettings = await db
      .select()
      .from(applicationSettingsTable)
      .limit(1)

    if (existingSettings.length > 0 && existingSettings[0]!.isBootstrapped) {
      console.log('[bootstrap-seed] Already bootstrapped, skipping.')
      await disconnect()
      process.exit(0)
    }

    // Read config
    const rawConfig = fs.readFileSync(resolvedPath, 'utf-8')
    const config: BootstrapConfig = JSON.parse(rawConfig)

    console.log('[bootstrap-seed] Starting bootstrap...')

    // Resolve URLs with backward compat (old configs use rpcUrl for what is now pocketApiUrl)
    const pocketApiUrl = config.settings.pocketApiUrl || config.settings.rpcUrl || ''
    const pocketRpcUrl = config.settings.pocketRpcUrl || ''

    if (!pocketApiUrl) {
      throw new Error('Bootstrap config missing pocketApiUrl (or rpcUrl for backward compat)')
    }

    // 0. Fetch blockchain params from API (minimumStake + current height)
    const rpcBase = pocketApiUrl.replace(/\/$/, '')
    const stakeBuffer = parseInt(process.env.MINIMUM_STAKE_BUFFER || '0', 10)
    let minimumStake = 0
    let updatedAtHeight = '0'

    try {
      // Fetch minimum stake
      const supplierParamsUrl = `${rpcBase}/pokt-network/poktroll/supplier/params`
      console.log(`[bootstrap-seed] Fetching minimum stake from ${supplierParamsUrl}...`)
      const paramsResponse = await fetch(supplierParamsUrl)
      if (!paramsResponse.ok) throw new Error(`Supplier params: HTTP ${paramsResponse.status}`)
      const paramsData = await paramsResponse.json()
      const rawAmount = parseFloat(paramsData.params.min_stake.amount)
      minimumStake = (rawAmount + stakeBuffer) / 1e6
      console.log(`[bootstrap-seed] Minimum stake: ${minimumStake} POKT (raw: ${rawAmount}, buffer: ${stakeBuffer})`)

      // Fetch current height
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

    // 1. Create owner user
    console.log('[bootstrap-seed] Creating owner user...')
    await db
      .insert(usersTable)
      .values({
        identity: ownerIdentity,
        email: ownerEmail,
        role: UserRole.Owner,
      })
      .onConflictDoNothing()

    // 2. Create application settings
    console.log('[bootstrap-seed] Creating application settings...')
    await db.insert(applicationSettingsTable).values({
      name: config.settings.name,
      appIdentity,
      supportEmail: config.settings.supportEmail,
      ownerIdentity: ownerIdentity,
      ownerEmail: ownerEmail,
      chainId: config.settings.chainId as any,
      minimumStake,
      initialOperationalFunds: config.settings.initialOperationalFunds,
      minimumOperationalFunds: config.settings.minimumOperationalFunds,
      isBootstrapped: false, // will set to true at the end
      pocketApiUrl,
      pocketRpcUrl,
      indexerApiUrl: config.settings.indexerApiUrl,
      updatedAtHeight,
      rewardAddresses: config.settings.rewardAddresses ?? [],
      returnSupplierFundsToOwner: config.settings.returnSupplierFundsToOwner ?? false,
      createdBy: ownerIdentity,
      updatedBy: ownerIdentity,
    })

    // 3. Create regions
    console.log('[bootstrap-seed] Creating regions...')
    const regionNameToId: Record<string, number> = {}
    for (const region of config.regions) {
      const [inserted] = await db
        .insert(regionsTable)
        .values({
          displayName: region.displayName,
          urlValue: region.urlValue,
          createdBy: ownerIdentity,
          updatedBy: ownerIdentity,
        })
        .returning({ id: regionsTable.id })

      regionNameToId[region.displayName] = inserted!.id
      console.log(`[bootstrap-seed]   Region "${region.displayName}" -> id ${inserted!.id}`)
    }

    // 4. Create relay miners
    console.log('[bootstrap-seed] Creating relay miners...')
    const relayMinerNameToId: Record<string, number> = {}
    for (const rm of config.relayMiners) {
      const regionId = regionNameToId[rm.regionName]
      if (regionId === undefined) {
        throw new Error(
          `[bootstrap-seed] Relay miner "${rm.name}" references unknown region "${rm.regionName}". ` +
          `Available regions: ${Object.keys(regionNameToId).join(', ')}`,
        )
      }

      const [inserted] = await db
        .insert(relayMinersTable)
        .values({
          name: rm.name,
          identity: rm.identity,
          regionId,
          domain: rm.domain,
          createdBy: ownerIdentity,
          updatedBy: ownerIdentity,
        })
        .returning({ id: relayMinersTable.id })

      relayMinerNameToId[rm.name] = inserted!.id
      console.log(`[bootstrap-seed]   Relay miner "${rm.name}" -> id ${inserted!.id}`)
    }

    // 5. Create services
    console.log('[bootstrap-seed] Creating services...')
    for (const svc of config.services) {
      await db.insert(servicesTable).values({
        serviceId: svc.serviceId,
        name: svc.name,
        ownerAddress: svc.ownerAddress ?? ownerIdentity,
        computeUnits: svc.computeUnits ?? 1,
        revSharePercentage: svc.revSharePercentage,
        endpoints: svc.endpoints.map((ep) => ({
          url: ep.url,
          rpcType: ep.rpcType,
        })),
        createdBy: ownerIdentity,
        updatedBy: ownerIdentity,
      })
      console.log(`[bootstrap-seed]   Service "${svc.serviceId}" created`)
    }

    // 6. Create address groups
    console.log('[bootstrap-seed] Creating address groups...')
    for (const ag of config.addressGroups) {
      const relayMinerId = relayMinerNameToId[ag.relayMinerName]
      if (relayMinerId === undefined) {
        throw new Error(
          `[bootstrap-seed] Address group "${ag.name}" references unknown relay miner "${ag.relayMinerName}". ` +
          `Available relay miners: ${Object.keys(relayMinerNameToId).join(', ')}`,
        )
      }

      const [insertedAg] = await db
        .insert(addressGroupTable)
        .values({
          name: ag.name,
          relayMinerId,
          private: ag.private ?? false,
          linkedAddresses: ag.linkedAddresses ?? [],
          createdBy: ownerIdentity,
          updatedBy: ownerIdentity,
        })
        .returning({ id: addressGroupTable.id })

      console.log(`[bootstrap-seed]   Address group "${ag.name}" -> id ${insertedAg!.id}`)

      // 7. Create address group services
      if (ag.services && ag.services.length > 0) {
        for (const agSvc of ag.services) {
          await db.insert(addressGroupServicesTable).values({
            addressGroupId: insertedAg!.id,
            serviceId: agSvc.serviceId,
            addSupplierShare: agSvc.addSupplierShare ?? false,
            supplierShare: agSvc.supplierShare ?? 0,
            revShare: agSvc.revShare ?? [],
          })
          console.log(`[bootstrap-seed]     Linked service "${agSvc.serviceId}" to address group "${ag.name}"`)
        }
      }
    }

    // 8. Fetch delegators from CDN and create them
    const delegatorsCdnUrl = process.env.DELEGATORS_CDN_URL
    if (delegatorsCdnUrl) {
      const resolvedUrl = delegatorsCdnUrl.replace('{chainId}', config.settings.chainId)
      console.log(`[bootstrap-seed] Fetching delegators from ${resolvedUrl}...`)
      try {
        const response = await fetch(resolvedUrl)
        if (!response.ok) {
          console.warn(`[bootstrap-seed] Failed to fetch delegators (${response.status}), skipping.`)
        } else {
          const cdnDelegators: CdnDelegator[] = await response.json()
          for (const del of cdnDelegators) {
            await db
              .insert(delegatorsTable)
              .values({
                name: del.name,
                identity: del.identity,
                enabled: true,
                createdBy: ownerIdentity,
                updatedBy: ownerIdentity,
              })
              .onConflictDoNothing()
            console.log(`[bootstrap-seed]   Delegator "${del.name}" created`)
          }
        }
      } catch (err) {
        console.warn('[bootstrap-seed] Error fetching delegators, skipping:', err)
      }
    } else {
      console.log('[bootstrap-seed] DELEGATORS_CDN_URL not set, skipping delegators.')
    }

    // 9. Create notification channels (if any)
    if (config.channels && config.channels.length > 0) {
      console.log('[bootstrap-seed] Creating notification channels...')
      const existingChannels = await db
        .select()
        .from(notificationChannelsTable)
        .limit(1)

      if (existingChannels.length > 0) {
        console.log('[bootstrap-seed] Notification channels already exist, skipping.')
      } else {
        for (const ch of config.channels) {
          await db.insert(notificationChannelsTable).values({
            name: ch.name,
            type: ch.type as NotificationChannelType,
            config: ch.config,
            notificationFlags: ch.notificationFlags ?? DEFAULT_NOTIFICATION_FLAGS,
            enabled: ch.enabled ?? true,
            createdBy: ownerIdentity,
            updatedBy: ownerIdentity,
          })
          console.log(`[bootstrap-seed]   Channel "${ch.name}" (${ch.type}) created`)
        }
      }
    } else {
      console.log('[bootstrap-seed] No channels in config, skipping.')
    }

    // 10. Set isBootstrapped = true
    console.log('[bootstrap-seed] Setting isBootstrapped = true...')
    await db
      .update(applicationSettingsTable)
      .set({ isBootstrapped: true, updatedBy: ownerIdentity })
      .where(eq(applicationSettingsTable.ownerIdentity, ownerIdentity))

    console.log('[bootstrap-seed] Bootstrap complete!')
  } catch (error) {
    console.error('[bootstrap-seed] Bootstrap failed:', error)
    await disconnect()
    process.exit(1)
  }

  await disconnect()
  process.exit(0)
}

main()
