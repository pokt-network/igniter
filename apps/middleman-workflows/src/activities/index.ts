import {
  ApplicationFailure,
  heartbeat,
  log,
  sleep,
} from '@temporalio/activity'
import {
  InsertNode,
  Node,
  Provider,
  Transaction,
} from '@igniter/db/middleman/schema'
import {
  NodeStatus,
  TransactionStatus,
} from '@igniter/db/middleman/enums'
import { extractTransactionStakingSuppliers, extractTransactionUnstakingSuppliers } from '@/workflows/utils'
import { ProviderService } from '@/lib/provider'
import DAL from '@/lib/dal/DAL'
import type { PocketBlockchain } from '@igniter/pocket'
import { NodesMinMax } from '@/lib/dal/nodes'

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

export const delegatorActivities = (dal: DAL, pocketRpcClient: PocketBlockchain, providerService: ProviderService) => ({
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
        const { ownerAddress, stake, unstakeSessionEndHeight } = supplier

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
   * @param {string} hash - The hash of the transaction to be verified.
   * @return {Promise<readonly [boolean, number, string]>} A promise that resolves to a tuple containing the success status (boolean), the transaction code (number), and the gas used (string). Throws an error if the transaction data is incomplete or not found.
   */
  async verifyTransaction(hash: string) {
    const tx = await pocketRpcClient.getTransaction(hash)
    if (!tx) {
      throw new Error('Transaction data is incomplete or not found')
    }
    return [tx.success, tx.code, tx.gasUsed?.toString() || '0'] as const
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
  async notifyProviderOfFailedStakes(transactionId: number) {
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

      const addresses = suppliers.map(({ address }) => address)

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
})
