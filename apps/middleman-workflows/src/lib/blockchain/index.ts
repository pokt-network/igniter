import {StargateClient} from '@cosmjs/stargate';
import { Buffer } from 'buffer'
import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { connectComet } from '@cosmjs/tendermint-rpc'

export interface SendTransactionResult {
  transactionHash: string;
  success: boolean;
  code?: number;
  message?: string;
}

export interface TransactionResult {
  hash: string;
  height: number;
  index?: number;
  gasUsed?: bigint;
  gasWanted?: bigint;
  success: boolean;
  code: number;
}

export interface IBlockchain {
  sendTransaction(payload: string): Promise<SendTransactionResult>;
  getBalance(address: string): Promise<number>;
  getHeight(): Promise<number>;
  getTransaction(txHash: string, height?: number): Promise<TransactionResult | null>;
}

export class Blockchain implements IBlockchain {
  private readonly rpcUrl: string;
  private readonly denom: string;
  private readonly apiUrl?: string;

  /**
   * @param rpcUrl bech32 Cosmos SDK RPC endpoint, e.g. https://rpc.cosmos.network
   * @param denom  staking token denom, e.g. "uatom" or "upokt"
   * @param apiUrl optional REST API endpoint for Tier 2 tx lookup
   */
  constructor(rpcUrl: string, denom: string = 'upokt', apiUrl?: string) {
    this.rpcUrl = rpcUrl;
    this.denom = denom;
    this.apiUrl = apiUrl;
  }

  /** Returns the numeric token balance for `address` in the configured `denom`. */
  async getBalance(address: string): Promise<number> {
    const client = await StargateClient.connect(this.rpcUrl);
    const coin = await client.getBalance(address, this.denom);
    return parseInt(coin.amount, 10);
  }

  /** Returns the latest block height from the chain. */
  async getHeight(): Promise<number> {

    const client = await StargateClient.connect(this.rpcUrl);

    try {
      return await client.getHeight();
    } catch (err) {
      console.error(err);
      throw new Error('Unable to fetch the height from the blockchain.');
    }
  }

  /**
   * Broadcasts a signed transaction (hex-encoded) to the network.
   * @param payload hex string of the signed tx bytes
   * @returns transactionHash and the full BroadcastTxResponse
   */
  async sendTransaction(payload: string): Promise<SendTransactionResult> {
    const client = await StargateClient.connect(this.rpcUrl);
    const txBytes = Buffer.from(payload, 'hex');
    try {
      const transactionHash = await client.broadcastTxSync(txBytes);
      return { transactionHash, success: true };
    } catch (error) {
      const { code, message } = error as { code: number; message: string };
      return {
        transactionHash: '',
        success: false,
        code,
        message,
      }
    }
  }

  /**
   * Retrieves transaction details by transaction hash using a 3-tier fallback:
   *   Tier 1: RPC tx_index via StargateClient.getTx
   *   Tier 2: REST API lookup (requires apiUrl)
   *   Tier 3: Block scan using SHA256 hash matching (requires height)
   * @param txHash The transaction hash to look up
   * @param height Optional block height hint for Tier 3 block scan
   * @returns Transaction details or null if not found
   */
  async getTransaction(txHash: string, height?: number): Promise<TransactionResult | null> {
    const client = await StargateClient.connect(this.rpcUrl);

    // Tier 1: RPC tx_index
    try {
      const tx = await client.getTx(txHash);
      if (tx) {
        return {
          hash: txHash,
          height: tx.height,
          index: tx.txIndex,
          gasUsed: tx.gasUsed,
          gasWanted: tx.gasWanted,
          success: tx.code === 0,
          code: tx.code,
        };
      }
    } catch (error) {
      console.warn('Tier 1 (RPC getTx) failed:', error);
    }

    // Tier 2: REST API
    if (this.apiUrl) {
      console.info(`Tier 1 returned null for ${txHash}, trying REST API fallback`);
      try {
        const url = `${this.apiUrl.replace(/\/$/, '')}/cosmos/tx/v1beta1/txs/${txHash}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          const txResponse = data.tx_response;
          if (txResponse) {
            return {
              hash: txResponse.txhash,
              height: parseInt(txResponse.height, 10),
              index: txResponse.tx_index ?? undefined,
              gasUsed: BigInt(txResponse.gas_used || '0'),
              gasWanted: BigInt(txResponse.gas_wanted || '0'),
              success: txResponse.code === 0,
              code: txResponse.code,
            };
          }
        }
      } catch (error) {
        console.warn('Tier 2 (REST API) failed:', error);
      }
    }

    // Tier 3: Block scan
    if (height) {
      console.info(`Tier 2 returned null for ${txHash}, trying block scan at height ${height}`);
      const maxBlocks = 30;
      try {
        const comet = await connectComet(this.rpcUrl);
        for (let h = height; h < height + maxBlocks; h++) {
          try {
            const block = await comet.block(h);
            const txs = block.block.txs;
            for (let i = 0; i < txs.length; i++) {
              const hash = toHex(sha256(txs[i])).toUpperCase();
              if (hash === txHash.toUpperCase()) {
                const results = await comet.blockResults(h);
                const txData = results.results[i];
                return {
                  hash: txHash,
                  height: h,
                  index: i,
                  gasUsed: txData.gasUsed,
                  gasWanted: txData.gasWanted,
                  success: txData.code === 0,
                  code: txData.code,
                };
              }
            }
          } catch (blockError) {
            console.warn(`Block scan error at height ${h}:`, blockError);
            continue;
          }
        }
      } catch (error) {
        console.warn('Tier 3 (block scan) failed to connect:', error);
      }
    }

    console.warn(`All tiers failed to find transaction ${txHash}`);
    return null;
  }
}
