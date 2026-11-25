import 'server-only'
import { Ripemd160, Secp256k1, Secp256k1Signature, sha256 } from '@cosmjs/crypto'
import { toBech32 } from '@cosmjs/encoding'
import { decodePubkey, makeSignBytes, makeSignDoc } from '@cosmjs/proto-signing'
import { AuthInfo, TxBody, TxRaw } from '@igniter/pocket/proto/cosmos/tx/v1beta1/tx'
import { PubKey } from '@igniter/pocket/proto/cosmos/crypto/secp256k1/keys'
import { MsgStakeSupplier, MsgUnstakeSupplier } from '@igniter/pocket/proto/pocket/supplier/tx'
import { MsgSend } from '@igniter/pocket/proto/cosmos/bank/v1beta1/tx'
import { SignMode } from '@igniter/pocket/proto/cosmos/tx/signing/v1beta1/signing'
import { POKT_ADDRESS_PREFIX } from '@/lib/utils/address'

const STAKE_TYPE_URL = '/pocket.supplier.MsgStakeSupplier'
const UNSTAKE_TYPE_URL = '/pocket.supplier.MsgUnstakeSupplier'
const SEND_TYPE_URL = '/cosmos.bank.v1beta1.MsgSend'
const SECP256K1_PUBKEY_TYPE_URL = '/cosmos.crypto.secp256k1.PubKey'

// Both wallets hand the signed TxRaw over as hex (see parseSignerAndSequence in
// middleman-workflows). Buffer.from(x, 'hex') stops silently at the first bad character, so the
// whole string is checked first.
const HEX_PATTERN = /^(?:[0-9a-fA-F]{2})+$/

function secp256k1PubkeyToAddress(key: Uint8Array): string {
  return toBech32(POKT_ADDRESS_PREFIX, new Ripemd160().update(sha256(key)).digest())
}

type DecodedTx = { txRaw: TxRaw; body: TxBody; authInfo: AuthInfo }

function decodeSignedTx(signedPayload: string): DecodedTx {
  if (!HEX_PATTERN.test(signedPayload)) throw new Error('The signed transaction is not valid hex')
  try {
    const txRaw = TxRaw.decode(Buffer.from(signedPayload, 'hex'))
    return { txRaw, body: TxBody.decode(txRaw.bodyBytes), authInfo: AuthInfo.decode(txRaw.authInfoBytes) }
  } catch {
    throw new Error('The signed transaction could not be decoded')
  }
}

/**
 * What the signature is checked against: the chain id from this middleman's settings and a chain
 * read of the signer's account number. Both are part of the SIGN_MODE_DIRECT SignDoc.
 */
export interface SignatureContext {
  chainId: string
  /** Throws when the chain cannot be read; the request is then refused. */
  getAccountNumber: (address: string) => Promise<number>
}

/**
 * The sender address, derived from the signer public key, which must also be the address the
 * client claims. Required: exactly one signer with a compressed secp256k1 public key. The
 * signature itself is checked by verifySignature once the messages are checked.
 */
function signerAddressOf({ authInfo }: DecodedTx, claimedAddress: string): string {
  if (authInfo.signerInfos.length !== 1) throw new Error('The signed transaction must have exactly one signer')
  const signerKey = authInfo.signerInfos[0]!.publicKey
  if (!signerKey) throw new Error('The signed transaction has no signer public key')
  if (signerKey.typeUrl !== SECP256K1_PUBKEY_TYPE_URL) throw new Error('The signed transaction signer key is not secp256k1')

  const signerAddress = secp256k1PubkeyToAddress(signerPubkey(signerKey.value))
  if (signerAddress !== claimedAddress) {
    throw new Error('The signed transaction is not signed by the transaction sender')
  }
  return signerAddress
}

function signerPubkey(value: Uint8Array): Uint8Array {
  let key: Uint8Array
  try {
    key = PubKey.decode(value).key
  } catch {
    throw new Error('The signed transaction signer key could not be decoded')
  }
  if (key.length !== 33) throw new Error('The signed transaction signer key is not a compressed secp256k1 key')
  return key
}

/**
 * Verifies the one signature over the SIGN_MODE_DIRECT SignDoc of the bytes as received, with the
 * chain id from the settings and the signer's account number read from chain. Both wallets sign in
 * SIGN_MODE_DIRECT; any other mode is refused. Must run before renderUnsignedPayload, which
 * rewrites the signer key.
 */
async function verifySignature({ txRaw, authInfo }: DecodedTx, signerAddress: string, context: SignatureContext): Promise<void> {
  const signerInfo = authInfo.signerInfos[0]!
  if (signerInfo.modeInfo?.single?.mode !== SignMode.SIGN_MODE_DIRECT) {
    throw new Error('The signed transaction uses an unsupported sign mode')
  }
  if (txRaw.signatures.length !== 1 || txRaw.signatures[0]!.length !== 64) {
    throw new Error('The signed transaction must carry one 64-byte signature')
  }
  if (!context.chainId) throw new Error('No chain id is configured')

  const pubkey = signerPubkey(signerInfo.publicKey!.value)
  const accountNumber = await context.getAccountNumber(signerAddress)
  const signDoc = makeSignDoc(txRaw.bodyBytes, txRaw.authInfoBytes, context.chainId, accountNumber)

  let valid = false
  try {
    valid = await Secp256k1.verifySignature(
      Secp256k1Signature.fromFixedLength(txRaw.signatures[0]!),
      sha256(makeSignBytes(signDoc)),
      pubkey,
    )
  } catch {
    valid = false
  }
  if (!valid) throw new Error('The transaction signature is not valid')
}

/** The stored JSON, in the shape KeplrWalletConnection `_getRawTxJson` stores. */
function renderUnsignedPayload({ txRaw, body, authInfo }: DecodedTx, messages: Array<{ typeUrl: string; value: unknown }>): string {
  // Same auth_info rendering as the Keplr wallet: the public key decoded to its amino form.
  for (const signerInfo of authInfo.signerInfos) {
    if (signerInfo.publicKey) {
      const decoded = decodePubkey(signerInfo.publicKey)
      signerInfo.publicKey = { typeUrl: decoded.type, value: decoded.value }
    }
  }

  return JSON.stringify({
    body: { ...body, messages },
    auth_info: authInfo,
    signatures: txRaw.signatures.map((signature) => Buffer.from(signature).toString('base64')),
  })
}

/**
 * Decodes the signed stake transaction the client sent and returns the unsigned payload JSON the
 * row stores, built from the signed bytes instead of taking the client's copy. The workflows
 * (extractTransactionStakingSuppliers, verifyStakeGoalState, the failure release) and the UI read
 * `body.messages[].{typeUrl,value}` from it, so it has the shape KeplrWalletConnection
 * `_getRawTxJson` already stores.
 *
 * Refuses anything that is not a stake: only MsgStakeSupplier (at least one) and MsgSend, each
 * signed/sent by `fromAddress` (a MsgStakeSupplier also owned by it), and a single signer whose
 * public key is `claimedAddress`'s and whose signature verifies (see verifySignature).
 *
 * Returns the payload and the sender address derived from the signer key, which callers store and
 * check against instead of the address the client names.
 */
export async function deriveStakeUnsignedPayload(
  signedPayload: string,
  claimedAddress: string,
  context: SignatureContext,
): Promise<{ unsignedPayload: string; fromAddress: string }> {
  const decoded = decodeSignedTx(signedPayload)
  // Read from the signer key before renderUnsignedPayload rewrites it to its amino form.
  const fromAddress = signerAddressOf(decoded, claimedAddress)

  let stakeCount = 0
  const messages = decoded.body.messages.map((message) => {
    if (message.typeUrl === STAKE_TYPE_URL) {
      const value = MsgStakeSupplier.decode(message.value)
      if (value.signer !== fromAddress || value.ownerAddress !== fromAddress) {
        throw new Error('The stake message is not signed by the transaction sender')
      }
      stakeCount++
      return { typeUrl: message.typeUrl, value }
    }
    if (message.typeUrl === SEND_TYPE_URL) {
      const value = MsgSend.decode(message.value)
      if (value.fromAddress !== fromAddress) {
        throw new Error('The send message is not from the transaction sender')
      }
      return { typeUrl: message.typeUrl, value }
    }
    throw new Error(`Unsupported message type in a stake transaction: ${message.typeUrl}`)
  })

  if (stakeCount === 0) throw new Error('The signed transaction has no stake message')

  await verifySignature(decoded, fromAddress, context)
  return { unsignedPayload: renderUnsignedPayload(decoded, messages), fromAddress }
}

/**
 * The unstake counterpart: only MsgUnstakeSupplier messages (at least one), each signed by the
 * sender, and a single signer whose public key is `claimedAddress`'s and whose signature verifies.
 * Returns the stored payload, the operator addresses being unstaked and the derived sender address.
 */
export async function deriveUnstakeUnsignedPayload(
  signedPayload: string,
  claimedAddress: string,
  context: SignatureContext,
): Promise<{ unsignedPayload: string; operatorAddresses: string[]; fromAddress: string }> {
  const decoded = decodeSignedTx(signedPayload)
  // Read from the signer key before renderUnsignedPayload rewrites it to its amino form.
  const fromAddress = signerAddressOf(decoded, claimedAddress)

  const messages = decoded.body.messages.map((message) => {
    if (message.typeUrl !== UNSTAKE_TYPE_URL) {
      throw new Error(`Unsupported message type in an unstake transaction: ${message.typeUrl}`)
    }
    const value = MsgUnstakeSupplier.decode(message.value)
    if (value.signer !== fromAddress) {
      throw new Error('The unstake message is not signed by the transaction sender')
    }
    return { typeUrl: message.typeUrl, value }
  })

  if (messages.length === 0) throw new Error('The signed transaction has no unstake message')

  await verifySignature(decoded, fromAddress, context)
  return {
    unsignedPayload: renderUnsignedPayload(decoded, messages),
    operatorAddresses: messages.map(({ value }) => value.operatorAddress),
    fromAddress,
  }
}
