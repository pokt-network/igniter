import {
  BroadcastTxError,
  calculateFee,
  GasPrice,
  ProtobufRpcClient,
  QueryClient,
  SigningStargateClient,
  StargateClient, TimeoutError,
} from '@cosmjs/stargate'
import {DirectSecp256k1Wallet, GeneratedType, Registry} from '@cosmjs/proto-signing'
import {TxRaw} from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import {
  Comet38Client,
  connectComet,
} from '@cosmjs/tendermint-rpc'
import {
  QueryAllBalancesRequest,
  QueryBalanceRequest,
  QueryClientImpl as BankQueryClientImpl,
  QuerySpendableBalanceByDenomRequest,
} from '@pocket/proto/generated/cosmos/bank/v1beta1/query'
import { Buffer } from 'buffer'
import {
  QueryClientImpl as SupplierQueryClientImpl,
  QueryGetSupplierRequest,
} from '@pocket/proto/generated/pocket/supplier/query'
import {
  PocketExtension,
  SendTransactionResult,
  TransactionResult,
} from '@pocket/types'
import { Coin } from '@pocket/proto/generated/cosmos/base/v1beta1/coin'
import { Supplier } from '@pocket/proto/generated/pocket/shared/supplier'
import {StakeSupplierParams} from "@pocket/types";
import {MsgStakeSupplier} from "@pocket/proto/generated/pocket/supplier/tx";
import {isValidPrivateKey} from "@pocket/utils";
import {getLogger, Logger} from '@igniter/logger'

export * from './types'
export * from './constants';

/**
 * Parses the expected sequence number from a Cosmos SDK account sequence mismatch error.
 * Error format: "account sequence mismatch, expected X, got Y: incorrect account sequence"
 * @returns The expected sequence number, or null if the error doesn't match.
 */
export function parseExpectedSequence(errorMessage: string): number | null {
  const match = errorMessage.match(/account sequence mismatch, expected (\d+), got (\d+)/)
  if (!match) return null
  return parseInt(match[1]!, 10)
}

/**
 * Returns true if the error message indicates a Cosmos SDK account sequence mismatch.
 */
export function isSequenceMismatchError(errorMessage: string): boolean {
  return errorMessage.includes('account sequence mismatch')
}

/**
 * Creates a Protobuf-based RPC client for querying a blockchain using a QueryClient.
 *
 * This client sends Protobuf-encoded requests to a specified service and method
 * and returns the Protobuf-encoded response received from the blockchain. It uses
 * the provided QueryClient for ABCI queries, enabling interaction with the
 * blockchain's query interface.
 *
 * @param {QueryClient} base - The base instance of QueryClient used to execute ABCI queries.
 * @param {number} [height] - Optional block height for which the queries should be executed.
 *                            If not provided, the latest block height is used.
 *
 * @returns {ProtobufRpcClient} A client capable of making Protobuf-encoded RPC requests.
 */
const createProtobufRpcClient = function (base: QueryClient, height?: number): ProtobufRpcClient {
  return {
    request: async (service: string, method: string, data: Uint8Array): Promise<Uint8Array> => {
      const path = `/${service}/${method}`
      const response = await base.queryAbci(path, data, height)
      return response.value
    },
  }
}

/**
 * Creates a new QueryClient with Pocket extension methods.
 * @param height Optional block height for which the queries should be executed.
 */
const setupPocketExtension = (height?: number) => (base: QueryClient): PocketExtension => {
  const rpc = createProtobufRpcClient(base, height)

  // Use this service to get easy typed access to query methods
  // This cannot be used for proof verification
  const bankQueryService = new BankQueryClientImpl(rpc)
  const supplierQueryService = new SupplierQueryClientImpl(rpc)

  return {
    bank: {
      balance: async (address: string, denom: string = 'upokt') => {
        let { balance } = await bankQueryService.Balance(
          QueryBalanceRequest.fromPartial({ address, denom }),
        )

        if (!balance) balance = Coin.fromPartial({ denom, amount: '0' })

        return balance
      },
      spendableBalanceByDenom: async (address: string, denom: string = 'upokt') => {
        let { balance } = await bankQueryService.SpendableBalanceByDenom(
          QuerySpendableBalanceByDenomRequest.fromPartial({ address, denom }),
        )

        if (!balance) balance = Coin.fromPartial({ denom, amount: '0' })

        return balance
      },
      allBalances: async (address: string) => {
        const { balances } = await bankQueryService.AllBalances(
          QueryAllBalancesRequest.fromPartial({ address: address }),
        )
        return balances
      },
    },
    supplier: {
      getSupplier: async (operatorAddress: string) => {
        const { supplier } = await supplierQueryService.Supplier(
          QueryGetSupplierRequest.fromPartial({ operatorAddress }),
        )
        return supplier || null
      },
    },
  }
}

/**
 * Returns a QueryClient with PocketExtension initialized using the provided Comet38Client.
 *
 * @param {Comet38Client} cometClient - The client to be used for creating the QueryClient.
 * @param {number} [height] - Optional height parameter to set up the PocketExtension.
 * @return {QueryClient & PocketExtension} The QueryClient with the added PocketExtension.
 */
export default function getQueryClient(cometClient: Comet38Client, height?: number): QueryClient & PocketExtension {
  return QueryClient.withExtensions(
    cometClient,
    setupPocketExtension(height),
  )
}

/**
 * A class that provides a wrapper around the StargateClient and Comet38Client for interacting with the blockchain.
 * It provides methods to connect, disconnect, get the balance, get the height, send a transaction, and retrieve transaction details.
 * It also provides methods to get the supplier address for a given address.
 */
export class PocketBlockchain {
  protected readonly rpcUrl: string
  protected readonly denom: string
  protected readonly gasPrice?: GasPrice
  protected stargateClient: StargateClient | undefined
  protected cometClient: Comet38Client | undefined
  protected logger: Logger;

  /**
   * @param rpcUrl bech32 Cosmos SDK RPC endpoint, e.g. https://rpc.cosmos.network
   * @param denom  staking token denom, e.g. "upokt"
   * @param gasPrice
   */
  private constructor(rpcUrl: string, denom: string = 'upokt', gasPrice = 0.001) {
    this.rpcUrl = rpcUrl
    this.denom = denom
    this.gasPrice = GasPrice.fromString(`${gasPrice}${denom}`)
    this.logger = getLogger().child({ service: 'pocket-blockchain' })
  }

  /**
   * Sets up a new instance of the Blockchain class and establishes a connection.
   *
   * @param {string} rpcUrl - The RPC URL for the blockchain connection.
   * @param {string} [denom='upokt'] - The denomination to be used, defaults to 'upokt'.
   * @param gasPrice
   * @return {Promise<Blockchain>} A promise that resolves to an instance of the Blockchain class.
   */
  static async setup(rpcUrl: string, denom: string = 'upokt', gasPrice = 0.001) {
    const blockchain = new PocketBlockchain(rpcUrl, denom, gasPrice)
    await blockchain.connect()
    return blockchain
  }

  /**
   * Connects to the blockchain and initializes the client.
   * NOTE: This method should be called before using any other methods, otherwise they will do it.
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    try {
      if (!this.cometClient) this.cometClient = await connectComet(this.rpcUrl) as Comet38Client
      if (!this.stargateClient) this.stargateClient = await StargateClient.create(this.cometClient, {})
    } catch (error) {
      console.error('Failed to connect to the blockchain:', error)
      throw new Error('Failed to connect to the blockchain.')
    }
  }

  /**
   * Returns the configured StargateClient instance.
   * @throws Error if the client is not initialized
   */
  async getStargateClient(): Promise<StargateClient> {
    if (!this.stargateClient) {
      await this.connect()
    }
    return this.stargateClient!
  }

  /**
   * Returns the configured Comet38Client instance.
   * @throws Error if the client is not initialized
   */
  async getCometClient(): Promise<Comet38Client> {
    if (!this.cometClient) {
      await this.connect()
    }

    return this.cometClient!
  }

  /** Disconnects StartGate client. */
  disconnect(): void {
    if (this.stargateClient) {
      this.stargateClient.disconnect()
      this.stargateClient = undefined
    }
    if (this.cometClient) {
      this.cometClient.disconnect()
      this.cometClient = undefined
    }
  }

  /** Returns the numeric token balance for `address` in the configured `denom`. */
  async getBalance(address: string, height?: number): Promise<number> {
    const client = await this.getCometClient()
    const queryClient = getQueryClient(client, height)

    const coin = await queryClient.bank.balance(address, this.denom)

    return parseInt(coin.amount, 10)
  }

  /** Returns the latest block height from the chain. */
  async getHeight(): Promise<number> {
    const client = await this.getStargateClient()

    try {
      return await client.getHeight()
    } catch (err) {
      console.error(err)
      throw new Error('Unable to fetch the height from the blockchain.')
    }
  }

  /**
   * Broadcasts a signed transaction (hex-encoded) to the network.
   * @param payload hex string of the signed tx bytes
   * @returns transactionHash and the full BroadcastTxResponse
   */
  async sendTransaction(payload: string): Promise<SendTransactionResult> {
    const client = await this.getStargateClient()
    const txBytes = Buffer.from(payload, 'hex')
    try {
      const transactionHash = await client.broadcastTxSync(txBytes)
      return { transactionHash, success: true }
    } catch (error) {
      const { code, message } = error as { code: number; message: string }
      return {
        transactionHash: '',
        success: false,
        code,
        message,
      }
    }
  }

  /**
   * Retrieves transaction details by transaction hash
   * @param txHash The transaction hash to look up
   * @returns Transaction details or null if not found
   */
  async getTransaction(txHash: string): Promise<TransactionResult | null> {
    const client = await this.getStargateClient()

    try {
      const tx = await client.getTx(txHash)

      if (!tx) {
        return null
      }

      return {
        hash: txHash,
        height: tx.height,
        index: tx.txIndex,
        gasUsed: tx.gasUsed,
        gasWanted: tx.gasWanted,
        success: tx.code === 0,
        code: tx.code,
      }
    } catch (error) {
      console.error('Error fetching transaction:', error)
      return null
    }
  }

  /**
   * Retrieves the supplier address for a given address.
   * @param address Supplier address to look up.
   * @param height The height to query for.
   * @returns The supplier address or null if not found.
   */
  async getSupplier(address: string, height?: number): Promise<Supplier | null> {
    const client = await this.getCometClient()
    const queryClient = getQueryClient(client, height)

    try {
      return await queryClient.supplier.getSupplier(address)
    } catch (e) {
      if((e as Error).message.includes('code = NotFound')) {
        return null
      }
      throw e
    }
  }

  async stakeSupplier(params: StakeSupplierParams, explicitSequence?: number): Promise<SendTransactionResult> {
    const { signerPrivateKey, signer, ...value } = params

    this.logger.info({ params: { signer, ...value }, explicitSequence },'stakeSupplier: Execution started')

    if (!isValidPrivateKey(signerPrivateKey)) throw new Error('Invalid secp256k1 private key')
    if (!signer) throw new Error('`signer` (bech32) is required')

    this.logger.debug({ params: { signer, ...value } },'stakeSupplier: Validated params')

    const pkBytes = Uint8Array.from(Buffer.from(signerPrivateKey, 'hex'))
    const wallet = await DirectSecp256k1Wallet.fromKey(pkBytes, 'pokt')
    const typeUrl = '/pocket.supplier.MsgStakeSupplier'

    try {
      const [account] = await wallet.getAccounts()

      this.logger.debug('stakeSupplier: Wallet accounts retrieved');

      if (account && account?.address !== signer) {
        throw new Error(`Signer address mismatch. Wallet=${account?.address} provided=${signer}`)
      }

      this.logger.debug('stakeSupplier: Wallet accounts validated');

      const registry = new Registry([
        [typeUrl, MsgStakeSupplier as unknown as GeneratedType],
      ])

      const signingClient = await this.getSigningClient(wallet, registry)

      this.logger.debug('stakeSupplier: Signing client created');

      const msg = { typeUrl, value: { signer, ...value } as MsgStakeSupplier }

      // TODO: Create signed memo
      const currentHeight = await this.getHeight();

      this.logger.debug({
        currentHeight,
        signer,
        messages: [msg],
        fee: 'auto',
        explicitSequence,
      },'stakeSupplier: Signing and broadcasting transaction')

      let result
      if (explicitSequence != null) {
        // Use explicit sequence to avoid sequence mismatch on retry
        this.logger.info({ signer, explicitSequence }, 'stakeSupplier: Using explicit sequence for signing')
        const gasEstimation = await signingClient.simulate(signer, [msg], '')
        const fee = calculateFee(Math.round(gasEstimation * 1.3), this.gasPrice!)
        const { accountNumber } = await signingClient.getSequence(signer)
        const chainId = await signingClient.getChainId()
        this.logger.debug({ signer, accountNumber, explicitSequence, chainId }, 'stakeSupplier: Signing with explicit signer data')
        const txRaw = await signingClient.sign(signer, [msg], fee, '', {
          accountNumber,
          sequence: explicitSequence,
          chainId,
        }, BigInt(currentHeight + 5))
        const txBytes = TxRaw.encode(txRaw).finish()
        this.logger.debug({ signer }, 'stakeSupplier: Broadcasting transaction with explicit sequence')
        result = await signingClient.broadcastTx(txBytes)
      } else {
        result = await signingClient.signAndBroadcast(signer, [msg], 'auto', '', BigInt(currentHeight + 5))
      }

      this.logger.info({ result },'stakeSupplier: Execution ended. Transaction sent.')

      return {
        transactionHash: result.transactionHash,
        code: result.code,
        message: result.rawLog,
        success: true,
      }
    } catch (e: any) {
      const errorMessage = e.log && e.message ? `${e.log} - ${e.message}` : e.message ?? 'Unknown error'
      this.logger.error({ code: e.code, message: e.message, log: e.log },'stakeSupplier: An error occurred while trying to execute the transaction.')
      if (e instanceof BroadcastTxError) {
        return {
          transactionHash: '',
          success: false,
          code: e.code,
          message: errorMessage,
        }
      }

      if (e instanceof TimeoutError) {
        return {
          transactionHash: e.txId,
          success: false,
          message: `Transaction timed out. This does not indicate a failure. Details: ${errorMessage}`,
          code: 42, // Timeout Transaction error code. See: https://github.com/cosmos/cosmos-sdk/blob/main/types/errors/errors.go
        }
      }

      this.logger.info({ error: e },'stakeSupplier: Execution ended  in errors.')

      return {
        transactionHash: '',
        success: false,
        message: `An unknown error occurred: ${errorMessage}`,
      }
    }
  }

  private async getSigningClient(
    wallet: DirectSecp256k1Wallet,
    registry: Registry,
  ): Promise<SigningStargateClient> {
    const comet = await this.getCometClient()
    return await SigningStargateClient.createWithSigner(comet, wallet, {
      registry,
      gasPrice: this.gasPrice,
      broadcastTimeoutMs: 3 * 60 * 1000,
    })
  }
}
