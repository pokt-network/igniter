import {
  ApplicationFailure,
  heartbeat,
  log,
  sleep,
} from '@temporalio/activity'
import {
  AddressGroupsJson,
  InsertNode,
  Node,
  NodeService,
  Provider,
  Transaction,
} from '@igniter/db/middleman/schema'
import {
  NodeStatus,
  TransactionStatus,
  TransactionType,
  SupplierChangeType,
} from '@igniter/db/middleman/enums'
import { createHash } from 'node:crypto'
import { detectSupplierChanges, DetectedSupplierChange } from '@igniter/domain/middleman/utils/supplierChanges'
import { extractTransactionStakingSuppliers, extractTransactionUnstakingSuppliers } from '@/workflows/utils'
import { ProviderService } from '@/lib/provider'
import DAL from '@/lib/dal/DAL'
import type { PocketBlockchain, SupplierServiceConfig, SupplierEndpoint, ServiceRevenueShare, VerifyOutcome, SupplierEffect } from '@igniter/pocket'
import type { VerificationDecision, SupplierPathOutcome } from '@igniter/tx-verify'
import { TX_EXPIRATION_BLOCKS } from '@igniter/tx-verify'
import { STAKE_TYPE_URL, UNSTAKE_TYPE_URL } from '@/lib/constants'
import { ServiceConfigUpdate } from '@igniter/pocket/proto/pocket/shared/supplier'
import { NodesMinMax } from '@/lib/dal/nodes'
import { verifyStakeGoalState } from './verifyStakeGoalStateHelper'
import { parseSignerAndSequence } from './parseSignerAndSequence'

export type Height = number

export type LoadNodesInRangeParams = {
  minId: number;
  maxId: number;
}

export type LoadNodesInRangeResult = Array<{ id: number; address: string }>

export type UpsertSupplierStatusParams = {
  address: string;
  height: number;
}

export type RewardBySupplier = {
  relays: number
  service_id: string
  gross_rewards: number
  computed_units: number
  estimated_relays: number
  estimated_computed_units: number
  staked_suppliers: number
}


/**
 * Extracts the hostname from a URL string, stripping the protocol, port, and path.
 * Returns null if the URL cannot be parsed.
 */
function extractDomainFromUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname || null
  } catch {
    // Fallback for URLs with template placeholders that confuse the URL parser
    let s = rawUrl.replace(/^https?:\/\//, '')
    s = (s.split('/')[0] ?? '').split(':')[0] ?? ''
    return s || null
  }
}

/**
 * Returns the unique set of relay miner domains for an address group, derived from
 * each service's endpoint URLs. Falls back to relayMiner.domain when:
 *   - the service has no endpoints, OR
 *   - the endpoint URL ends with the literal "{domain}" template placeholder.
 * Otherwise extracts the domain directly from the endpoint URL.
 */
function extractDomainsForAddressGroup(ag: AddressGroupsJson[number]): string[] {
  const domains = new Set<string>()
  for (const ags of ag.addressGroupServices) {
    const endpoints = ags.service?.endpoints
    if (!endpoints || endpoints.length === 0) {
      domains.add(ag.relayMiner.domain)
    } else {
      for (const ep of endpoints) {
        if (ep.url.endsWith('{domain}')) {
          domains.add(ag.relayMiner.domain)
        } else {
          const domain = extractDomainFromUrl(ep.url)
          if (domain) domains.add(domain)
        }
      }
    }
  }

  return Array.from(domains).map((d) => {
    const parts = d.split('.')
    return parts.length > 2 ? parts.slice(-2).join('.') : d
  })
}

export type GovernanceSyncResult = {
  inserted: number;
  updated: number;
  disabled: number;
}

export const governanceActivities = (dal: DAL) => ({
  async syncProvidersFromGovernance(): Promise<GovernanceSyncResult> {
    const settings = await dal.appSettings.getFirst()
    if (!settings) {
      throw ApplicationFailure.nonRetryable('Application settings not found', 'settings_not_found')
    }

    const cdnUrlTemplate = process.env.PROVIDERS_CDN_URL
    if (!cdnUrlTemplate) {
      throw ApplicationFailure.nonRetryable('PROVIDERS_CDN_URL environment variable is not defined', 'missing_env')
    }

    const cdnUrl = cdnUrlTemplate.replace(
      '{chainId}',
      settings.chainId.replace('lego-testnet', 'beta'),
    )

    log.info('syncProvidersFromGovernance: Fetching from CDN', { cdnUrl })

    const response = await fetch(cdnUrl)
    if (!response.ok) {
      throw ApplicationFailure.retryable(`Failed to fetch providers: ${response.statusText}`, 'fetch_failed')
    }

    type CdnProvider = {
      name: string;
      identity: string;
      identityHistory: string[];
      url: string;
    }

    const providersFromCdn = (await response.json()) as CdnProvider[]
    log.info('syncProvidersFromGovernance: Fetched providers', { count: providersFromCdn.length })

    const result = await dal.provider.upsertFromGovernance(
      providersFromCdn,
      settings.ownerIdentity,
    )

    log.info('syncProvidersFromGovernance: Done', result)
    return result
  },
})

/** Number of consecutive unavailable checks between critical alerts for a chronically-unverifiable tx. */
const VERIFY_UNAVAILABLE_ALERT_THRESHOLD = Number(process.env.VERIFY_UNAVAILABLE_ALERT_THRESHOLD ?? 50)

/** Per-sweep hash-scan window, matching the on-chain mempool expiration window. */
// TX_EXPIRATION_BLOCKS imported from @igniter/tx-verify above

/**
 * Parses a transaction's unsigned payload into the expected on-chain supplier effect.
 * Returns null when the tx has no supplier-state path (send / OperationalFunds), so the
 * verifier knows to skip the supplier verification path for it.
 */

export const delegatorActivities = (dal: DAL, pocketRpcClient: PocketBlockchain, providerService: ProviderService) => {
  const activities = {
  /**
   * Returns the latest block height from the blockchain.
   * @returns GetLatestBlockResult
   */
  async getLatestBlock(): Promise<Height> {
    return pocketRpcClient.getHeight()
  },
  /**
   * Counts the number of keys in the database and return the min and max id.
   * @returns KeysMinMax
   */
  async getNodesMinAndMax(): Promise<NodesMinMax> {
    return dal.node.getNodesMinAndMax()
  },

  /**
   * Loads nodes within the specified range based on the provided parameters.
   *
   * @param {LoadNodesInRangeParams} params - An object containing the criteria for loading the nodes, including:
   *    - minId: The minimum ID to define the range.
   *    - maxId: The maximum ID to define the range.
   * @return {Promise<LoadNodesInRangeParams>} A promise that resolves to the loaded nodes within the specified range.
   */
  async loadNodesInRange(params: LoadNodesInRangeParams): Promise<LoadNodesInRangeResult> {
    return dal.node.loadNodesInRange(params.minId, params.maxId)
  },

  async upsertSupplierStatus(params: UpsertSupplierStatusParams): Promise<boolean> {
    try {
      log.info('Querying supplier status', { params })
      const [node, balance, supplier] = await Promise.all([
        dal.node.loadNode(params.address),
        pocketRpcClient.getBalance(params.address),
        pocketRpcClient.getSupplier(params.address),
      ])

      if (!node) {
        throw new ApplicationFailure('key not found', 'not_found', true)
      }

      const update: Partial<InsertNode> = {
        lastUpdatedHeight: params.height, // always set the last updated height.
        balance: BigInt(balance), // always set the balance.
      }

      // if !supplier then is available only if the current state is different from available
      // if supplier and unstakeSessionEndHeight = 0 then is staked
      // if supplier and unstakeSessionEndHeight > 0 and unstakeSessionEndHeight < height then is unstaking
      // if supplier and unstakeSessionEndHeight > 0 and unstakeSessionEndHeight >= height then is unstaked

      // Determine the node status
      if (!supplier) {
        switch (node.status) {
          case NodeStatus.Staked:
          case NodeStatus.Unstaking:
            update.status = NodeStatus.Unstaked
            break
          default:
            update.status = node.status
        }
      } else {
        const { ownerAddress, stake, unstakeSessionEndHeight, services, serviceConfigHistory } = supplier

        // Supplier is present, determine state based on unstakeSessionEndHeight
        if (unstakeSessionEndHeight === 0) {
          update.status = NodeStatus.Staked
        } else if (params.height >= unstakeSessionEndHeight) {
          update.status = NodeStatus.Unstaked
        } else {
          update.status = NodeStatus.Unstaking
        }

        if (update.status === NodeStatus.Unstaking || update.status === NodeStatus.Staked) {
          update.ownerAddress = ownerAddress
          update.stakeAmount = stake ? stake.amount : '0'

          const activeServices: Array<{
            serviceId: string,
            endpoints: Array<{ url: string, rpcType: string }>,
            revShare: Array<{ address: string, revSharePercentage: string }>,
          }> = services.map((svc: SupplierServiceConfig) => ({
            serviceId: svc.serviceId,
            endpoints: svc.endpoints.map((ep: SupplierEndpoint) => ({ url: ep.url, rpcType: ep.rpcType })),
            revShare: svc.revShare.map((rs: ServiceRevenueShare) => ({ address: rs.address, revSharePercentage: rs.revSharePercentage })),
          }))

          // Include pending entries from serviceConfigHistory (deactivationHeight === 0) that are
          // not yet reflected in the active services array. This covers two cases:
          //   1. New services scheduled for a future activationHeight (not in services[] yet)
          //   2. Existing services with a pending config update (same serviceId, different config)
          // Entries whose serviceId + config already match an active service are skipped.
          const pendingServices = (serviceConfigHistory ?? [])
            .filter((sc: ServiceConfigUpdate) => !sc.deactivationHeight && !!sc.service)
            .filter((sc: ServiceConfigUpdate) => {
              const svc = sc.service!
              const activeMatch = activeServices.find(a => a.serviceId === svc.serviceId)
              if (!activeMatch) return true // new service not yet in services[]
              // Include if config differs from the currently active version (pending update)
              const endpointsMatch = JSON.stringify(activeMatch.endpoints) ===
                JSON.stringify(svc.endpoints.map((ep: SupplierEndpoint) => ({ url: ep.url, rpcType: ep.rpcType })))
              const revShareMatch = JSON.stringify(activeMatch.revShare) ===
                JSON.stringify(svc.revShare.map((rs: ServiceRevenueShare) => ({ address: rs.address, revSharePercentage: rs.revSharePercentage })))
              return !endpointsMatch || !revShareMatch
            })
            .map((sc: ServiceConfigUpdate) => ({
              serviceId: sc.service!.serviceId,
              endpoints: sc.service!.endpoints.map((ep: SupplierEndpoint) => ({ url: ep.url, rpcType: ep.rpcType })),
              revShare: sc.service!.revShare.map((rs: ServiceRevenueShare) => ({ address: rs.address, revSharePercentage: rs.revSharePercentage })),
              pendingActivationHeight: sc.activationHeight,
            }))

          update.services = [...activeServices, ...pendingServices]
        }
      }

      // Detect changes in services/rev-share and persist them
      if (node.services && node.services.length > 0 && update.services) {
        try {
          const changes = detectSupplierChanges(
            node.services,
            update.services as NodeService[],
            node.ownerAddress,
          )

          if (changes.length > 0) {
            const batchInput = [
              node.providerId ?? 'unknown',
              ...changes.map((c: DetectedSupplierChange) => c.changeType).sort(),
              ...changes.map((c: DetectedSupplierChange) => c.serviceId).sort(),
              String(params.height),
            ].join('-')
            const batchId = createHash('sha256').update(batchInput).digest('hex')

            await dal.supplierChanges.insertChanges(
              node.id,
              changes.map((c: DetectedSupplierChange) => ({
                changeType: c.changeType as SupplierChangeType,
                serviceId: c.serviceId,
                description: c.description,
                previousValue: c.previousValue,
                newValue: c.newValue,
                batchId,
              })),
            )
            log.info('Supplier changes detected and persisted', {
              address: params.address,
              changeCount: changes.length,
              batchId,
            })
          }
        } catch (e) {
          log.error('Error detecting/persisting supplier changes', { error: e })
          // Non-fatal — don't block the status update
        }
      }

      log.info('Updating supplier', { params, update }) //NOTE: adding the update could result in an error due to BIGINT
      try {
        await dal.node.updateNode(params.address, update, params.height)
      } catch (e) {
        log.error('Error updating node record', { error: e })
        throw new ApplicationFailure('errored updating node record', 'update_error', false, null, e as Error)
      }
      log.info('Upsert Supplier done!', { params })
    } catch (e) {
      log.error('Error upserting supplier status', { error: e })
      throw new ApplicationFailure('errored upserting supplier status', 'update_error', false, null, e as Error)
    }
    return true
  },

  /**
   * Retrieves a transaction by its ID from the database.
   *
   * @param {number} transactionId - The unique identifier of the transaction to be retrieved.
   * @return {Promise<{id: number, hash: string, status: string}>} A promise that resolves to an object containing the transaction details, including its ID, hash, and status.
   * @throws {Error} If the transaction is not found in the database.
   */
  async getTransaction(transactionId: number) {
    const transaction = await dal.transaction.getTransaction(transactionId)
    if (!transaction) {
      throw new Error('Transaction not found on the database')
    }
    return {
      id: transaction.id,
      hash: transaction.hash,
      status: transaction.status,
      type: transaction.type,
      executionHeight: transaction.executionHeight,
      unsignedPayload: transaction.unsignedPayload,
    }
  },
  /**
   * Retrieves a list of transactions that are pending and maps them to an array of objects containing their id and createdAt timestamp.
   *
   * @return {Promise<Array<{id: string, createdAt: Date}>>} A promise that resolves to an array of objects, each containing the transaction id and createdAt timestamp.
   */
  async listTransactions() {
    const txs = await dal.transaction.listByStatus(TransactionStatus.Pending)
    // @ts-ignore (todo: fix this)
    return txs.map(({ id, createdAt }) => ({ id, createdAt }))
  },
  /**
   * Retrieves a list of all available providers.
   *
   * @return {Promise<Array>} A promise resolving to an array of provider objects.
   */
  async listProviders() {
    return dal.provider.list()
  },
  /**
   * Fetches the status of the given list of providers by sending a signed payload containing identity information.
   *
   * @param {Provider[]} providers - An array of provider objects for which the status will be fetched.
   * @return {Promise<Object[]>} A promise that resolves to an array of status results.
   * Each result will either be the status of the provider if fulfilled,
   * or an error object if the request was rejected.
   */
  async fetchProviderStatus(providers: Provider[]) {
    const { signature, identity } = await providerService.signPayload(JSON.stringify({}))

    const providerStatus = await Promise.allSettled(
      providers.map(async (provider) =>
        providerService.status(provider, signature, identity)),
    )

    return providerStatus.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        return {
          ...result.reason,
        }
      }
    })
  },
  /**
   * Updates the list of providers in the data layer with the given provider information.
   *
   * @param {Provider[]} providers - An array of Provider objects to be updated in the data layer.
   * @return {Promise<void>} A promise that resolves when the update operation is complete.
   */
  async updateProviders(providers: Provider[]) {
    await dal.provider.updateProviders(providers)
  },
  /**
   * Reads the timeoutHeight embedded in the signed payload for a transaction.
   * Reuses parseSignerAndSequence's TxBody decode path. Returns null when the
   * payload is absent, unparseable, or has no embedded timeout (external-wallet txs).
   */
  async getTxTimeoutHeight(transactionId: number): Promise<number | null> {
    const txn = await dal.transaction.getTransaction(transactionId)
    if (!txn?.signedPayload) return null
    const { timeoutHeight } = parseSignerAndSequence(txn.signedPayload)
    return timeoutHeight
  },

  /**
   * Updates a transaction with the given payload.
   *
   * @param {number} transactionId - The unique identifier of the transaction to be updated.
   * @param {Partial<Transaction>} payload - An object containing the partial fields of the transaction to be updated.
   * @return {Promise<Transaction>} A promise that resolves to the updated transaction object.
   * @throws {Error} If the transaction with the given ID is not found.
   */
  async updateTransaction(
    transactionId: number,
    payload: Partial<Transaction>,
  ) {
    const transaction = await dal.transaction.getTransaction(transactionId)
    if (!transaction) {
      throw new Error('Transaction not found')
    }
    return await dal.transaction.updateTransaction(transactionId, payload)
  },
  /**
   * Executes a transaction based on the given transaction ID.
   *
   * @param {number} transactionId - The unique identifier of the transaction to be executed.
   * @return {Promise<any>} A promise that resolves with the result of the transaction execution or rejects if the transaction is not found or not signed.
   */
  async executeTransaction(transactionId: number) {
    const transaction = await dal.transaction.getTransaction(transactionId)
    if (!transaction) {
      throw new Error('Transaction not found')
    }

    if (!transaction.signedPayload) {
      throw new Error('Transaction is not signed')
    }

    return pocketRpcClient.sendTransaction(transaction.signedPayload)
  },
  /**
   * Retrieves the current block height from the RPC client.
   *
   * @return {Promise<number>} A promise that resolves to the current block height.
   */
  async getBlockHeight() {
    return await pocketRpcClient.getHeight()
  },
  /**
   * Waits for the blockchain to reach the next block after the specified transaction height.
   *
   * @param {number} txHeight - The height of the transaction to wait for the next block.
   * @return {Promise<boolean>} A promise that resolves to a boolean value indicating the completion of the wait.
   */
  async waitForNextBlock(txHeight: number): Promise<boolean> {
    let currentHeight = await pocketRpcClient.getHeight()
    while (currentHeight < txHeight + 1) {
      await sleep(5 * 1000)
      heartbeat()
      currentHeight = await pocketRpcClient.getHeight()
    }
    return true
  },
  /**
   * Verifies the transaction status by the given transaction hash.
   *
   * Returns `[success, code, gasUsed]` when the tx is found on-chain. Throws a retriable
   * `ApplicationFailure` when the tx is not (yet) found — the workflow's activity retry
   * policy handles re-checking across blocks until the expiration window closes.
   */
  async verifyTransaction(
    hash: string,
    height?: number,
  ): Promise<readonly [boolean, number, string]> {
    const tx = await pocketRpcClient.getTransaction(hash, height)
    if (tx) {
      return [tx.success, tx.code, tx.gasUsed?.toString() || '0'] as const
    }

    throw ApplicationFailure.retryable(
      'Transaction not found on-chain',
      'TX_NOT_FOUND',
      { hash, height },
    )
  },
  /**
   * Returns true only when a supplier exists on-chain at `operatorAddress` AND it is
   * owned by `expectedOwnerAddress`. Used as a Tier 4 positive-only fallback for Stake
   * transactions when `verifyTransaction` exhausts its retries without finding the tx
   * hash. The ownership check guards against a false positive: during the ~30-block
   * verify window another operator could stake the same address, so existence alone is
   * not proof that *our* stake is the one that landed.
   */
  async checkSupplierOnChain(operatorAddress: string, expectedOwnerAddress: string): Promise<boolean> {
    const supplier = await pocketRpcClient.getSupplier(operatorAddress)
    return !!supplier && supplier.ownerAddress === expectedOwnerAddress
  },
  /**
   * Creates new nodes based on the data extracted from a provided transaction.
   *
   * This method retrieves a transaction using the given transaction ID, extracts the staked nodes information,
   * and inserts the newly created nodes into the database. It returns a list of the newly created nodes
   * containing their IDs and addresses. If the transaction is not found or any error occurs, an empty array is returned.
   *
   * @param {number} transactionId - The ID of the transaction from which to extract node information.
   * @return {Promise<Pick<Node, 'id' | 'address'>[]>} A promise containing an array of newly created nodes,
   *         with each node having its ID and address. Returns an empty array if an error occurs.
   */
  async createNewNodesFromTransaction(transactionId: number): Promise<Pick<Node, 'id' | 'address'>[]> {
    try {
      const transaction = await dal.transaction.getTransaction(transactionId)

      if (!transaction) {
        throw new Error('Transaction not found')
      }

      const newlyStakedNodes = extractTransactionStakingSuppliers(transaction)

      const newNodes: InsertNode[] = newlyStakedNodes.map(({ address, stakeAmount, balance, ownerAddress }) => ({
        status: NodeStatus.Staked,
        ownerAddress,
        stakeAmount,
        balance: BigInt(balance),
        address,
        providerId: transaction.providerId,
        createdBy: transaction.createdBy,
      }))

      return dal.node.insert(newNodes, transaction.id)
    } catch (error) {
      console.log('Something went wrong while parsing the transaction to extract the staked nodes information.')
      console.error(error)
      return []
    }
  },
  /**
   * Updates nodes to unstaking status based on the data extracted from a provided transaction.
   * This method also creates relationships between the transaction and the updated nodes.
   *
   * This method retrieves a transaction using the given transaction ID, extracts the unstaking nodes information,
   * updates their status to Unstaking, and creates the transaction-to-node relationships in the database.
   *
   * @param {number} transactionId - The ID of the transaction from which to extract node information.
   * @return {Promise<Array<string>>} A promise containing an array of unstaking node addresses. Returns an empty array if an error occurs.
   */
  async updateUnstakingNodesFromTransaction(transactionId: number): Promise<Array<string>> {
    try {
      const transaction = await dal.transaction.getTransaction(transactionId)

      if (!transaction) {
        throw new Error('Transaction not found')
      }

      const newlyUnstakingNodes = extractTransactionUnstakingSuppliers(transaction)

      const addresses = newlyUnstakingNodes.map(node => node.operatorAddress)

      await dal.node.updateManyNodeAndLinkToTransaction(
        addresses,
        { status: NodeStatus.Unstaking },
        transaction.id
      )

      return addresses
    } catch (error) {
      console.log('Something went wrong while parsing the transaction to extract the unstaking nodes information.')
      console.error(error)
      return []
    }
  },
  /**
   * Notifies the provider associated with the given transaction of newly staked addresses.
   * It retrieves the transaction and provider information, extracts staked node addresses,
   * and marks those addresses as staked for the provider.
   *
   * @param {number} transactionId - The unique identifier of the transaction used to determine the associated provider and addresses.
   * @return A promise that resolves to an object containing the success status, an informative message, and the associated staked addresses (if applicable).
   */
  async notifyProviderOfStakedAddresses(transactionId: number) {
    try {
      const transaction = await dal.transaction.getTransaction(transactionId)

      if (!transaction || !transaction.providerId) {
        return {
          success: false,
          message: 'Transaction not found or transaction is not associated to a provider.',
        }
      }

      const provider = await dal.provider.getProvider(transaction.providerId)

      if (!provider) {
        return {
          success: false,
          message: 'Provider not found.',
        }
      }

      const newlyStakedNodes = extractTransactionStakingSuppliers(transaction)

      const addresses = newlyStakedNodes.map(({ address }) => address)

      await providerService.markOwnerStaked(addresses, provider)

      return {
        success: true,
        message: 'Successfully marked the addresses as staked.',
        addresses,
      }
    } catch (error) {
      const { message } = error as Error
      log.error('Error registering namespace', { error })
      return {
        success: false,
        message: message || 'An unknown error occurred while notifying the provider of the staked addresses.',
      }
    }
  },
  /**
   * Notifies the provider associated with the given transaction of newly unstaking addresses.
   * It retrieves the transaction and provider information, extracts unstaking node addresses,
   * and marks those addresses as unstaking for the provider.
   *
   * @param {number} transactionId - The unique identifier of the transaction used to determine the associated provider and addresses.
   * @return A promise that resolves to an object containing the success status, an informative message, and the associated staked addresses (if applicable).
   */
  async notifyProviderOfUntakingAddresses(transactionId: number) {
    try {
      const transaction = await dal.transaction.getTransaction(transactionId)

      if (!transaction) {
        return {
          success: false,
          message: 'Transaction not found or transaction is not associated to a provider.',
        }
      }

      const unstakingSuppliers = extractTransactionUnstakingSuppliers(transaction)

      const addresses = unstakingSuppliers.map(({ operatorAddress }) => operatorAddress)

      const nodes = await dal.node.loadNodes(addresses)

      if (!nodes || nodes.length === 0 || addresses.length !== nodes.length) {
        return {
          success: false,
          message: 'No nodes found for the given addresses.',
        }
      }

      const providerById: Record<string, Provider> = {}

      const nodesByProvider = nodes.reduce((acc, node) => {
        if (!node.providerId) return acc

        if (!acc[node.providerId]) {
          acc[node.providerId] = []
        }

        acc[node.providerId]!.push(node.address)
        providerById[node.providerId] = node.provider!

        return acc
      }, {} as Record<string, Array<string>>)

      await Promise.all(
        Object.entries(nodesByProvider).map(([providerId, nodes]) => {
          const provider = providerById[providerId]

          if (!provider) throw new Error('Provider not found.')

          return providerService.markOwnerUnstaking(nodes, provider)
        })
      )

      return {
        success: true,
        message: 'Successfully marked the addresses as unstaking.',
        addresses,
      }
    } catch (error) {
      const { message } = error as Error
      log.error('Error registering namespace', { error })
      return {
        success: false,
        message: message || 'An unknown error occurred while notifying the provider of the staked addresses.',
      }
    }
  },

  /**
   * Notifies a provider of failed stakes associated with a transaction.
   *
   * @param {number} transactionId - The unique identifier of the transaction.
   * @return A promise that resolves to an object containing the result of the operation.
   * The object includes:
   *   - `success` (boolean): Indicates the success or failure of the operation.
   *   - `message` (string): A message describing the result of the operation.
   *   - `addresses` (Array<string>): (Optional) A list of released supplier addresses if the operation is successful.
   */
  /**
   * Fetches supplier address groups from each provider for the supplier nodes staked with that provider.
   *
   * @param {Provider[]} providers - The list of providers to query.
   * @return {Promise<Array>} A promise that resolves to an array of per-provider address group results.
   */
  async fetchSupplierAddressGroups(providers: Provider[]) {
    const results = await Promise.all(
      providers.map(async (provider) => {
        const addresses = await dal.node.getStakedNodesByProvider(provider.identity)

        if (addresses.length === 0) {
          return null
        }

        const addressGroups = await providerService.fetchSupplierAddressGroups(addresses, provider)

        const sentAddressSet = new Set(addresses.map((a) => a.toLowerCase()))
        const validatedAddressGroups = addressGroups
          .map((ag) => {
            const validAddresses = ag.addresses.filter((addr) => {
              return true;

              const valid = sentAddressSet.has(addr.toLowerCase())
              if (!valid) {
                log.warn('Provider returned address not in sent set — dropping to prevent fraud', {
                  provider: provider.identity,
                  addressGroupId: ag.id,
                  address: addr,
                })
              }
              return valid
            })
            return { ...ag, addresses: validAddresses }
          })
          .filter((ag) => ag.addresses.length > 0)

        return {
          providerId: provider.id,
          providerIdentity: provider.identity,
          addressGroups: validatedAddressGroups,
        }
      })
    )

    return results.filter((result) => result !== null)
  },

  /**
   * Fetches gross rewards per service for each address group over the last 7 days from the
   * indexer GraphQL API using the relay miner domains derived from service endpoint URLs.
   * Applies the supplier mint allocation percentage, filters to only services configured in
   * each address group, and persists the net rewards into the addressGroups JSONB column.
   *
   * @param providers - The list of providers whose address group rewards should be updated.
   */
  async fetchAndStoreAddressGroupRewards(providers: Provider[]) {
    const appSettings = await dal.appSettings.getFirst()
    const indexerApiUrl = appSettings?.indexerApiUrl

    if (!indexerApiUrl) {
      log.warn('indexerApiUrl not configured in app settings — skipping address group rewards fetch')
      return
    }

    // Fetch latest block timestamp and supplier allocation percentage in parallel
    const latestBlockQuery = `
      {
        blocks(orderBy: ID_DESC, first: 1) {
          nodes {
            id
            timestamp
          }
        }
      }
    `
    const paramQuery = `
      query GetSupplierAllocation {
        param(id: "tokenomics-mint_allocation_percentages") {
          value
        }
      }
    `
    const [latestBlockResponse, paramResponse] = await Promise.all([
      fetch(indexerApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: latestBlockQuery }),
      }),
      fetch(indexerApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: paramQuery }),
      }),
    ])

    const latestBlockResult = await latestBlockResponse.json() as { data: { blocks: { nodes: Array<{ id: string; timestamp: string }> } } }
    const latestBlockTimestamp = latestBlockResult.data?.blocks?.nodes?.[0]?.timestamp

    const latestBlock = latestBlockTimestamp ? new Date(latestBlockTimestamp) : new Date()
    const Y = latestBlock.getUTCFullYear()
    const M = latestBlock.getUTCMonth()
    const D = latestBlock.getUTCDate()
    const endTs = new Date(Date.UTC(Y, M, D, 23, 59, 59, 999))
    const startTs = new Date(Date.UTC(Y, M, D - 6, 0, 0, 0, 0))

    const paramResult = await paramResponse.json() as { data: { param: { value: string } | null } }
    const supplierAllocation = paramResult.data?.param?.value
      ? (JSON.parse(paramResult.data.param.value) as { supplier: number }).supplier
      : -1

    if (supplierAllocation === -1) {
      throw new Error('Failed to fetch supplier allocation percentage from indexer')
    }

    const rewardsQuery = `
      query RewardsByDomains($domains: [String!]!, $startTs: Datetime!, $endTs: Datetime!) {
        data: getRewardsByDomainsAndTimeGroupByService(
          domains: $domains,
          startTs: $startTs,
          endTs: $endTs
        )
      }
    `

    const supplierStatsQuery = `
      query SupplierStatsByDomains($domains: [String!]!) {
        data: getSupplierStatsByDomains(domains: $domains)
      }
    `

    await Promise.all(
      providers.map(async (provider) => {
        const dbProvider = await dal.provider.getProvider(provider.identity)
        if (!dbProvider) {
          log.warn('Provider not found, skipping rewards fetch', { providerIdentity: provider.identity })
          return null
        }

        const addressGroups = (dbProvider.addressGroups ?? [])
        const currentAddressGroups = addressGroups as Array<{ id: number; grossRewardsPerService?: unknown; [key: string]: unknown }>

        // Collect all unique domains across all address groups for the provider-level stats query
        const allDomains = Array.from(
          new Set(addressGroups.flatMap((ag) => extractDomainsForAddressGroup(ag)))
        )

        // Fetch supplier stats once per provider and per-address-group rewards in parallel
        const [supplierStatsResult, rewardsByGroupId] = await Promise.all([
          allDomains.length > 0
            ? fetch(indexerApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: supplierStatsQuery, variables: { domains: ['easy2stake.com','nodefleet.net'] } }),
              })
                .then((r) => r.json() as Promise<{ data: { data: { suppliers_count: number; total_staked_tokens: number } } }>)
                .catch((e) => { log.error('Failed to fetch supplier stats', { error: e }); return null })
            : Promise.resolve(null),

          Promise.all(
            addressGroups
              .filter((ag) => ag.addressGroupServices.length > 0)
              .map(async (ag) => {
                const domains = extractDomainsForAddressGroup(ag)

                if (domains.length === 0) {
                  log.warn('No domains extracted for address group, skipping', { addressGroupId: ag.id })
                  return null
                }

                try {
                  const response = await fetch(indexerApiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      query: rewardsQuery,
                      variables: { domains: ag.id === 1 ? ['easy2stake.com'] : ['nodefleet.net'], startTs: startTs.toISOString(), endTs: endTs.toISOString() },
                    }),
                  })
                  const result = await response.json() as { data: { data: { services: RewardBySupplier[]; suppliers_count: number } } }
                  const rawRewards: Array<RewardBySupplier> = result.data?.data?.services ?? []

                  const configuredServiceIds = new Set(ag.addressGroupServices.map((s) => s.serviceId))
                  const filteredRewards = rawRewards.filter((r) => configuredServiceIds.has(r.service_id) || true)

                  const adjustedRewards = filteredRewards.map((entry) => ({
                    ...entry,
                    amount: Math.floor(entry.gross_rewards * supplierAllocation).toString(),
                  }))

                  return { id: ag.id, rewards: adjustedRewards }
                } catch (e) {
                  log.error('Failed to fetch rewards for address group', { addressGroupId: ag.id, error: e })
                  return null
                }
              })
          ),
        ])

        const supplierStats = supplierStatsResult?.data?.data ?? null
        const suppliersCount = supplierStats?.suppliers_count ?? 0

        for (const entry of rewardsByGroupId) {
          if (!entry) continue
          const matchingEntry = currentAddressGroups.find((ag) => ag.id === entry.id)
          if (matchingEntry) {
            matchingEntry.grossRewardsPerService = entry.rewards
            matchingEntry.rewardsSuppliersCount = suppliersCount
            matchingEntry.rewardsUpdatedAt = new Date().toISOString()
          }
        }

        await dal.provider.updateProvider(dbProvider.id, {
          addressGroups: currentAddressGroups as typeof dbProvider.addressGroups,
          supplierStats,
        })
      })
    )
  },

  /**
   * Processes all status-related operations for a single provider:
   * fetches and updates provider status, supplier address groups, and address group rewards.
   *
   * @param {string} providerIdentity - The identity of the provider to process.
   */
  async processProviderStatus(providerIdentity: string) {
    const provider = await dal.provider.getProvider(providerIdentity)
    if (!provider) {
      log.warn('Provider not found, skipping', { providerIdentity })
      return null
    }

    const { signature, identity } = await providerService.signPayload(JSON.stringify({}))
    let statusResult: Provider
    try {
      statusResult = await providerService.status(provider, signature, identity)
    } catch (e) {
      statusResult = { ...(e as object) } as Provider
    }

    // Preserve existing reward data in address groups so the status update doesn't wipe it
    if (statusResult.addressGroups && provider.addressGroups) {
      const existingGroupsMap = new Map(
        (provider.addressGroups as Array<{ id: number; grossRewardsPerService?: unknown; rewardsSuppliersCount?: unknown; rewardsUpdatedAt?: unknown }>)
          .map(ag => [ag.id, ag])
      )
      statusResult.addressGroups = statusResult.addressGroups.map((ag) => {
        const existing = existingGroupsMap.get(ag.id)
        if (!existing) return ag
        return {
          ...ag,
          grossRewardsPerService: existing.grossRewardsPerService,
          rewardsSuppliersCount: existing.rewardsSuppliersCount,
          rewardsUpdatedAt: existing.rewardsUpdatedAt,
        } as typeof ag
      })
    }

    await dal.provider.updateProviders([statusResult])

    const appSettings = await dal.appSettings.getFirst()
    const indexerApiUrl = appSettings?.indexerApiUrl

    if (!indexerApiUrl) {
      log.warn('indexerApiUrl not configured in app settings — skipping address group rewards fetch', { providerIdentity })
      return { statusResult }
    }

    const latestBlockQuery = `
      {
        blocks(orderBy: ID_DESC, first: 1) {
          nodes {
            id
            timestamp
          }
        }
      }
    `
    const paramQuery = `
      query GetSupplierAllocation {
        param(id: "tokenomics-mint_allocation_percentages") {
          value
        }
      }
    `
    const [latestBlockResponse, paramResponse] = await Promise.all([
      fetch(indexerApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: latestBlockQuery }),
      }),
      fetch(indexerApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: paramQuery }),
      }),
    ])

    const latestBlockResult = await latestBlockResponse.json() as { data: { blocks: { nodes: Array<{ id: string; timestamp: string }> } } }
    const latestBlockTimestamp = latestBlockResult.data?.blocks?.nodes?.[0]?.timestamp

    const latestBlock = latestBlockTimestamp ? new Date(latestBlockTimestamp) : new Date()
    const Y = latestBlock.getUTCFullYear()
    const M = latestBlock.getUTCMonth()
    const D = latestBlock.getUTCDate()
    const endTs = new Date(Date.UTC(Y, M, D, 23, 59, 59, 999))
    const startTs = new Date(Date.UTC(Y, M, D - 6, 0, 0, 0, 0))

    const paramResult = await paramResponse.json() as { data: { param: { value: string } | null } }
    const supplierAllocation = paramResult.data?.param?.value
      ? (JSON.parse(paramResult.data.param.value) as { supplier: number }).supplier
      : -1

    if (supplierAllocation === -1) {
      throw new Error('Failed to fetch supplier allocation percentage from indexer')
    }

    const rewardsQuery = `
      query RewardsByDomains($domains: [String!]!, $startTs: Datetime!, $endTs: Datetime!) {
        data: getRewardsByDomainsAndTimeGroupByService(
          domains: $domains,
          startTs: $startTs,
          endTs: $endTs
        )
      }
    `
    const supplierStatsQuery = `
      query SupplierStatsByDomains($domains: [String!]!) {
        data: getSupplierStatsByDomains(pDomains: $domains)
      }
    `

    const dbProvider = await dal.provider.getProvider(provider.identity)
    if (!dbProvider) {
      log.warn('Provider not found after status update, skipping rewards fetch', { providerIdentity: provider.identity })
      return { statusResult }
    }

    const addressGroupsData = (dbProvider.addressGroups ?? [])
    const currentAddressGroups = addressGroupsData as Array<{ id: number; grossRewardsPerService?: unknown; [key: string]: unknown }>

    const allDomains = Array.from(
      new Set(addressGroupsData.flatMap((ag) => extractDomainsForAddressGroup(ag)))
    )

    const [supplierStatsResult, rewardsByGroupId] = await Promise.all([
      allDomains.length > 0
        ? fetch(indexerApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: supplierStatsQuery, variables: { domains: allDomains } }),
          })
            .then((r) => r.json() as Promise<{ data: { data: { suppliers_count: number; total_staked_tokens: number } } }>)
            .catch((e) => { log.error('Failed to fetch supplier stats', { error: e }); return null })
        : Promise.resolve(null),

      Promise.all(
        addressGroupsData
          .filter((ag) => ag.addressGroupServices.length > 0)
          .map(async (ag) => {
            const domains = extractDomainsForAddressGroup(ag)

            if (domains.length === 0) {
              log.warn('No domains extracted for address group, skipping', { addressGroupId: ag.id })
              return null
            }

            try {
              const response = await fetch(indexerApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  query: rewardsQuery,
                  variables: { domains, startTs: startTs.toISOString(), endTs: endTs.toISOString() },
                }),
              })
              const result = await response.json() as { data: { data: { services: RewardBySupplier[]; suppliers_count: number } } }
              const rawRewards: Array<RewardBySupplier> = result.data?.data?.services ?? []

              const configuredServiceIds = new Set(ag.addressGroupServices.map((s) => s.serviceId))
              const filteredRewards = rawRewards.filter((r) => configuredServiceIds.has(r.service_id) || true)

              const adjustedRewards = filteredRewards.map((entry) => ({
                ...entry,
                amount: Math.floor(entry.gross_rewards * supplierAllocation).toString(),
              }))

              return { id: ag.id, rewards: adjustedRewards }
            } catch (e) {
              log.error('Failed to fetch rewards for address group', { addressGroupId: ag.id, error: e })
              return null
            }
          })
      ),
    ])

    const supplierStats = supplierStatsResult?.data?.data ?? null
    const suppliersCount = supplierStats?.suppliers_count ?? 0

    for (const entry of rewardsByGroupId) {
      if (!entry) continue
      const matchingEntry = currentAddressGroups.find((ag) => ag.id === entry.id)
      if (matchingEntry) {
        matchingEntry.grossRewardsPerService = entry.rewards
        matchingEntry.rewardsSuppliersCount = suppliersCount
        matchingEntry.rewardsUpdatedAt = new Date().toISOString()
      }
    }

    await dal.provider.updateProvider(dbProvider.id, {
      addressGroups: currentAddressGroups as typeof dbProvider.addressGroups,
      supplierStats,
    })

    return { statusResult }
  },

  async notifyProviderOfFailedStakes(transactionId: number, onlyAddresses?: string[]) {
    try {
      const transaction = await dal.transaction.getTransaction(transactionId)

      if (!transaction || !transaction.providerId) {
        return {
          success: false,
          message: 'Transaction not found or transaction is not associated to a provider.',
        }
      }

      const provider = await dal.provider.getProvider(transaction.providerId)

      if (!provider) {
        return {
          success: false,
          message: 'Provider not found.',
        }
      }

      const suppliers = extractTransactionStakingSuppliers(transaction)

      const addresses = suppliers
        .map(({ address }) => address)
        .filter((addr) => !onlyAddresses || onlyAddresses.includes(addr))

      if (addresses.length === 0) {
        return {
          success: true,
          message: 'No addresses to release.',
        }
      }

      await providerService.releaseSuppliers(addresses, provider)

      return {
        success: true,
        message: 'Successfully released the addresses.',
        addresses,
      }
    } catch (error) {
      const { message } = error as Error
      log.error('An error occurred while trying to inform provider of released addresses', { error })
      return {
        success: false,
        message: message || 'An unknown error occurred while notifying the provider of the addresses release',
      }
    }
  },

  /**
   * The verifier's queue: pending transactions that have been broadcast (have a hash).
   */
  async listPendingWithHash() {
    const txs = await dal.transaction.listPendingWithHash()
    // @ts-ignore (todo: align serialized shape with the workflow)
    return txs.map(({ id, executionHeight }) => ({ id, executionHeight }))
  },

  /**
   * Verifies a broadcast tx by hash, scanning from one block past its last covered
   * height (or its execution height on the first sweep). Maps the pocket tri-state
   * result down to the minimal shape the pure decision logic consumes.
   */
  async verifyTxHash(transactionId: number): Promise<VerifyOutcome<{ success: boolean; code: number; gasUsed: string }>> {
    const txn = await dal.transaction.getTransaction(transactionId)
    if (!txn?.hash) {
      throw new Error('verifyTxHash: tx missing hash')
    }
    const startHeight = txn.lastCoveredHeight != null ? txn.lastCoveredHeight + 1 : (txn.executionHeight ?? 0)
    const out = await pocketRpcClient.verifyTransaction(txn.hash, startHeight, TX_EXPIRATION_BLOCKS)
    if (out.status !== 'confirmed') return out
    // gasUsed is serialized as a string: a bigint cannot cross the Temporal
    // activity boundary (the default payload converter cannot encode BigInt).
    return {
      status: 'confirmed',
      data: { success: out.data.success, code: out.data.code, gasUsed: out.data.gasUsed.toString() },
    }
  },

  /**
   * Verifies a broadcast tx by its expected on-chain supplier goal-state. Returns null for
   * tx types with no supplier-state path (send / OperationalFunds) so the decision logic
   * treats the supplier path as inapplicable. Uses goal-state semantics: the tx is
   * confirmed if every operator's on-chain state matches intent, regardless of which tx
   * produced it.
   */
  async verifySupplierEffect(transactionId: number): Promise<SupplierPathOutcome | null> {
    const txn = await dal.transaction.getTransaction(transactionId)
    if (!txn) throw new Error('verifySupplierEffect: tx not found')

    if (txn.type === TransactionType.Stake || txn.type === TransactionType.Upstake) {
      return verifyStakeGoalState(txn, (addr) => pocketRpcClient.getSupplier(addr))
    }

    if (txn.type === TransactionType.Unstake) {
      const [unstake] = extractTransactionUnstakingSuppliers(txn)
      if (!unstake) return null
      const effect = { kind: 'unstake' as const, minSessionEndHeight: txn.executionHeight ?? 0 }
      const out = await pocketRpcClient.verifySupplierEffect(unstake.operatorAddress, effect)
      if (out.status === 'confirmed') return { status: 'confirmed' }
      if (out.status === 'absent') return { status: 'absent', absentOperators: [unstake.operatorAddress] }
      return { status: 'unavailable' }
    }

    return null
  },

  /**
   * Extracts tx validity evidence (timeoutHeight, sequence) from the signed payload.
   * Used to drive the hash-absent path in decideVerification toward expired/sequence-consumed
   * verdicts without waiting for the full expiration window.
   */
  async checkTxValidityEvidence(transactionId: number): Promise<{
    txTimeoutHeight: number | null
    sequence: { consumed: boolean; observedAtHeight: number } | null
  }> {
    const txn = await dal.transaction.getTransaction(transactionId)
    if (!txn) return { txTimeoutHeight: null, sequence: null }

    if (!txn.signedPayload) return { txTimeoutHeight: null, sequence: null }

    const parsed = parseSignerAndSequence(txn.signedPayload)

    if (parsed.timeoutHeight) return { txTimeoutHeight: parsed.timeoutHeight, sequence: null }

    if (parsed.sequence == null) return { txTimeoutHeight: null, sequence: null }

    let signer: string | null = null
    try {
      const { body } = JSON.parse(txn.unsignedPayload)
      signer = body.messages[0]?.value?.signer ?? null
    } catch { /* ignore */ }

    if (!signer) return { txTimeoutHeight: null, sequence: null }

    try {
      const sequenceEvidence = await pocketRpcClient.isSequenceConsumed(signer, parsed.sequence)
      return { txTimeoutHeight: null, sequence: sequenceEvidence }
    } catch {
      return { txTimeoutHeight: null, sequence: null }
    }
  },

  /**
   * Applies a verification decision computed by the pure `decideVerification` (v2 shape).
   * Pending → record progress (coverage/unavailable) + maybe alert on chronic unavailability.
   * Terminal → run downstream effects BEFORE the CAS so idempotent re-runs on retry are safe;
   * only the caller that wins the CAS runs effects (zero-rows → already terminal, skip).
   */
  async applyVerificationDecision(transactionId: number, decision: VerificationDecision): Promise<void> {
    if (decision.tx === 'pending') {
      await dal.transaction.recordVerificationProgress(transactionId, {
        lastCoveredHeight: decision.newLastCoveredHeight,
        incUnavailable: decision.incUnavailable,
      })
      if (decision.incUnavailable) await maybeAlertUnavailable(transactionId)
      return
    }

    const txn = await dal.transaction.getTransaction(transactionId)
    if (!txn) return

    // Effects keyed off GOAL-STATE, not tx outcome: a tx that failed on-chain while a
    // sibling achieved the goal must NOT release staked suppliers. Effects run before
    // the CAS (idempotent; a partial run is re-swept).
    if (decision.effects === 'apply-success' && txn.type === TransactionType.Stake) {
      await activities.createNewNodesFromTransaction(txn.id)
      await activities.notifyProviderOfStakedAddresses(txn.id)
    } else if (decision.effects === 'apply-failure' && txn.type === TransactionType.Stake) {
      await activities.notifyProviderOfFailedStakes(txn.id, decision.failedOperators)
    } else if (decision.effects === 'apply-success' && txn.type === TransactionType.Unstake) {
      await activities.updateUnstakingNodesFromTransaction(txn.id)
      await activities.notifyProviderOfUntakingAddresses(txn.id)
    }

    const status = decision.tx === 'success' ? TransactionStatus.Success : TransactionStatus.Failure
    const verificationHeight = await pocketRpcClient.getHeight().catch(() => undefined)
    const fields: { code?: number; consumedFee?: number; verificationHeight?: number; log?: string } = {
      verificationHeight,
      log: decision.tx === 'success' ? 'verified'
        : decision.effects === 'apply-success' ? 'tx failed on-chain; goal met by sibling tx'
        : 'verification negative (validity bound covered, no effect)',
    }
    if (decision.code !== undefined) fields.code = decision.code
    if (decision.gasUsed !== undefined) fields.consumedFee = Number(decision.gasUsed)
    await dal.transaction.claimTerminalTransition(transactionId, status, fields)
  },
  }

  /**
   * Reads the tx and emits a critical log when its unavailable-check counter crosses a
   * multiple of the alert threshold. No status change — this is operator-attention only.
   */
  async function maybeAlertUnavailable(transactionId: number): Promise<void> {
    const txn = await dal.transaction.getTransaction(transactionId)
    if (txn && txn.unavailableChecks > 0 && txn.unavailableChecks % VERIFY_UNAVAILABLE_ALERT_THRESHOLD === 0) {
      log.error(
        'TX unverifiable: RPC repeatedly unavailable — operator attention needed',
        { transactionId, unavailableChecks: txn.unavailableChecks },
      )
    }
  }

  return activities
}
