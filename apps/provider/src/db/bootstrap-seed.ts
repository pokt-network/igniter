import * as schema from '@igniter/db/provider/schema'
import type { NotificationChannelConfig, NotificationFlags } from '@igniter/db/provider/schema'
import { DEFAULT_NOTIFICATION_FLAGS, NotificationChannelType } from '@igniter/db/provider/schema'
import { UserRole } from '@igniter/db/provider/enums'
import { eq } from 'drizzle-orm'
import * as fs from 'fs'
import * as path from 'path'
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing'
import { setup } from '@igniter/db/connection'
import { configureLogging, getLogger } from '@igniter/logger'

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
  // Without this, every getLogger() call in this seed writes to a logger with no
  // configured sinks (blackhole). Wire the standard config so seed logs surface.
  await configureLogging({ serviceName: 'provider' })
  const logger = getLogger(['provider', 'seed'])

  const configPath = process.env.BOOTSTRAP_CONFIG_PATH
  if (!configPath) {
    logger.info('bootstrap skipped', { reason: 'BOOTSTRAP_CONFIG_PATH not set' })
    process.exit(0)
  }

  const resolvedPath = path.resolve(configPath)
  if (!fs.existsSync(resolvedPath)) {
    logger.info('bootstrap skipped', { reason: 'config file not found', path: resolvedPath })
    process.exit(0)
  }

  const ownerIdentity = process.env.OWNER_IDENTITY
  if (!ownerIdentity) {
    logger.fatal('OWNER_IDENTITY is required')
    process.exit(1)
  }

  const ownerEmail = process.env.OWNER_EMAIL || undefined

  const appIdentityPrivateKey = process.env.APP_IDENTITY
  if (!appIdentityPrivateKey) {
    logger.fatal('APP_IDENTITY is required')
    process.exit(1)
  }

  // Derive compressed public key from APP_IDENTITY private key
  const privateKeyBytes = Buffer.from(appIdentityPrivateKey, 'hex')
  const wallet = await DirectSecp256k1Wallet.fromKey(privateKeyBytes)
  const [account] = await wallet.getAccounts()
  if (!account) {
    logger.fatal('failed to derive public key from APP_IDENTITY')
    process.exit(1)
  }
  const appIdentity = Buffer.from(account.pubkey).toString('hex')

  // Connect to DB
  const { db, disconnect } = setup({ schema, logger })

  try {
    // Check if already bootstrapped
    const existingSettings = await db
      .select()
      .from(applicationSettingsTable)
      .limit(1)

    if (existingSettings.length > 0 && existingSettings[0]!.isBootstrapped) {
      logger.info('bootstrap skipped', { reason: 'already bootstrapped' })
      await disconnect()
      process.exit(0)
    }

    // Read config
    const rawConfig = fs.readFileSync(resolvedPath, 'utf-8')
    const config: BootstrapConfig = JSON.parse(rawConfig)

    logger.info('bootstrap starting')

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
      const paramsResponse = await fetch(supplierParamsUrl)
      if (!paramsResponse.ok) throw new Error(`Supplier params: HTTP ${paramsResponse.status}`)
      const paramsData = await paramsResponse.json()
      const rawAmount = parseFloat(paramsData.params.min_stake.amount)
      minimumStake = (rawAmount + stakeBuffer) / 1e6

      // Fetch current height
      const statusUrl = `${rpcBase}/cosmos/base/node/v1beta1/status`
      const statusResponse = await fetch(statusUrl)
      if (!statusResponse.ok) throw new Error(`Node status: HTTP ${statusResponse.status}`)
      const statusData = await statusResponse.json()
      updatedAtHeight = statusData.height

      logger.info('blockchain params fetched', { minimumStake, rawAmount, stakeBuffer, updatedAtHeight })
    } catch (err) {
      logger.fatal('failed to fetch blockchain params', { error: err })
      process.exit(1)
    }

    // 1. Create owner user
    await db
      .insert(usersTable)
      .values({
        identity: ownerIdentity,
        email: ownerEmail,
        role: UserRole.Owner,
      })
      .onConflictDoNothing()

    // 2. Create application settings
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
      logger.debug('region created', { displayName: region.displayName, id: inserted!.id })
    }
    logger.info('regions created', { count: config.regions.length })

    // 4. Create relay miners
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
      logger.debug('relay miner created', { name: rm.name, id: inserted!.id })
    }
    logger.info('relay miners created', { count: config.relayMiners.length })

    // 5. Create services
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
      logger.debug('service created', { serviceId: svc.serviceId })
    }
    logger.info('services created', { count: config.services.length })

    // 6. Create address groups
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

      logger.debug('address group created', { name: ag.name, id: insertedAg!.id })

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
          logger.debug('service linked to address group', { serviceId: agSvc.serviceId, addressGroup: ag.name })
        }
      }
    }
    logger.info('address groups created', { count: config.addressGroups.length })

    // 8. Fetch delegators from CDN and create them
    const delegatorsCdnUrl = process.env.DELEGATORS_CDN_URL
    if (delegatorsCdnUrl) {
      const resolvedUrl = delegatorsCdnUrl.replace('{chainId}', config.settings.chainId)
      try {
        const response = await fetch(resolvedUrl)
        if (!response.ok) {
          logger.warn('failed to fetch delegators, skipping', { status: response.status })
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
            logger.debug('delegator created', { name: del.name })
          }
          logger.info('delegators fetched', { count: cdnDelegators.length })
        }
      } catch (err) {
        logger.warn('error fetching delegators, skipping', { error: err })
      }
    } else {
      logger.debug('delegators skipped', { reason: 'DELEGATORS_CDN_URL not set' })
    }

    // 9. Create notification channels (if any)
    if (config.channels && config.channels.length > 0) {
      const existingChannels = await db
        .select()
        .from(notificationChannelsTable)
        .limit(1)

      if (existingChannels.length > 0) {
        logger.info('notification channels skipped', { reason: 'already exist' })
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
          logger.debug('notification channel created', { name: ch.name, type: ch.type })
        }
        logger.info('notification channels created', { count: config.channels.length })
      }
    } else {
      logger.debug('notification channels skipped', { reason: 'none in config' })
    }

    // 10. Set isBootstrapped = true
    await db
      .update(applicationSettingsTable)
      .set({ isBootstrapped: true, updatedBy: ownerIdentity })
      .where(eq(applicationSettingsTable.ownerIdentity, ownerIdentity))

    logger.info('bootstrap complete')
  } catch (error) {
    logger.fatal('bootstrap failed', { error })
    await disconnect()
    process.exit(1)
  }

  await disconnect()
  process.exit(0)
}

main()
