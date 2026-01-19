import {DirectSecp256k1Wallet} from "@cosmjs/proto-signing";
import { fromHex, toUtf8, toBech32 } from '@cosmjs/encoding';
import { Secp256k1, sha256, ripemd160 } from '@cosmjs/crypto';
import {env} from "@/config/env";

/**
 * Signs the given payload string using secp256k1 and the APP_IDENTITY private key from the environment.
 * The APP_IDENTITY must be a 64-character hex string (32 bytes).
 * @param payload
 */
export async function signPayload(payload: string) {
  const privateKeyBytes = fromHex(env.APP_IDENTITY);
  const messageHash = sha256(toUtf8(payload));
  const signature = await Secp256k1.createSignature(messageHash, privateKeyBytes);
  return Buffer.from(signature.toFixedLength());
}

export async function getCompressedPublicKeyFromAppIdentity() : Promise<Buffer> {
  const privateKeyBytes = Buffer.from(env.APP_IDENTITY, 'hex');
  const wallet = await DirectSecp256k1Wallet.fromKey(privateKeyBytes);
  const [account] = await wallet.getAccounts();

  if (!account) {
    throw new Error("Failed while trying to get the public key");
  }

  return Buffer.from(account.pubkey);
}

/**
 * Checks if a string is a valid POKT bech32 address format
 */
export function isPoktBech32Address(value: string): boolean {
  return /^pokt1[a-z0-9]{38,43}$/.test(value);
}

/**
 * Checks if a string looks like a hex public key (64 hex chars = 32 bytes)
 */
export function isHexPublicKey(value: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(value);
}

/**
 * Converts a hex-encoded compressed public key to a bech32 address.
 * Uses the standard Cosmos address derivation: SHA256 -> RIPEMD160 -> bech32
 */
export function pubkeyToAddress(hexPubKey: string, prefix: string = 'pokt'): string {
  const pubkeyBytes = fromHex(hexPubKey);
  const sha256Hash = sha256(pubkeyBytes);
  const ripemd160Hash = ripemd160(sha256Hash);
  return toBech32(prefix, ripemd160Hash);
}

/**
 * Normalizes an identity value to a bech32 address.
 * - If already a bech32 address, returns as-is
 * - If a hex public key (64 chars), attempts conversion to bech32
 * - Otherwise returns the original value
 */
export function normalizeIdentityToAddress(identity: string): string {
  if (isPoktBech32Address(identity)) {
    return identity;
  }

  if (isHexPublicKey(identity)) {
    try {
      const compressedPubkey = '02' + identity;
      return pubkeyToAddress(compressedPubkey);
    } catch {
      return identity;
    }
  }

  return identity;
}

