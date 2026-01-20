import {Secp256k1, Secp256k1Signature, sha256, ripemd160} from '@cosmjs/crypto';
import {toUtf8, toBech32, fromHex} from "@cosmjs/encoding";
import {DirectSecp256k1Wallet} from "@cosmjs/proto-signing";

/**
 * Verifies a secp256k1/ECDSA signature (DER‐encoded) against the given payload.
 *
 * @param payload       The original message (string)
 * @param publicKeyStr  The compressed public key (33‑byte) in base64 or hex
 * @param signatureStr  The DER‑encoded ECDSA signature in base64 or hex
 * @param encoding      'hex' or 'base64' (default: 'base64')
 * @returns             true if the signature is valid, false otherwise
 */
export async function verifySignature(
  payload: string,
  publicKeyStr: string,
  signatureStr: string,
  encoding: BufferEncoding = 'base64'
): Promise<boolean> {
  try {
    const publicKeyBytes = Buffer.from(publicKeyStr, encoding);

    if (
      publicKeyBytes.length !== 33 ||
      (publicKeyBytes[0] !== 0x02 && publicKeyBytes[0] !== 0x03)
    ) {
      throw new Error('Public key must be 33 bytes in compressed secp256k1 format.');
    }

    const signature = Buffer.from(signatureStr, encoding);

    return await Secp256k1.verifySignature(Secp256k1Signature.fromFixedLength(signature.subarray(0, 64)), sha256(toUtf8(payload)), publicKeyBytes);
  } catch (e: unknown) {
    console.error('Signature verification failed:', (e as Error).message);
    return false;
  }
}

export async function getCompressedPublicKeyFromAppIdentity() : Promise<Buffer> {
  const privateKeyBytes = Buffer.from(process.env.APP_IDENTITY!, 'hex');
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
 *
 * @param hexPubKey The hex-encoded public key (33 bytes compressed, 66 hex chars)
 * @param prefix The bech32 prefix (default: 'pokt')
 * @returns The bech32-encoded address
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
 *
 * This is useful for backwards compatibility when ownerIdentity may have been
 * stored as a hex public key instead of a bech32 address.
 */
export function normalizeIdentityToAddress(identity: string): string {
  // Already a valid bech32 address
  if (isPoktBech32Address(identity)) {
    return identity;
  }

  // Looks like a 32-byte hex value (64 chars) - might be a raw public key
  // Note: This is a best-effort conversion for legacy data
  if (isHexPublicKey(identity)) {
    try {
      // Try to convert assuming it's a compressed public key or needs prefix
      // For a 32-byte value, we need to add the compression prefix (02 or 03)
      // This is a heuristic - try with 02 prefix first
      const compressedPubkey = '02' + identity;
      return pubkeyToAddress(compressedPubkey);
    } catch {
      // If conversion fails, return original
      return identity;
    }
  }

  return identity;
}
