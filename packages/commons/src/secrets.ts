/**
 * Boot-time checks for the secrets a web app cannot run safely without. A placeholder or short
 * secret is refused instead of silently accepted (a CHANGEME AUTH_SECRET lets anyone forge sessions).
 */

const MIN_SECRET_BYTES = 32

function isPlaceholder(value: string): boolean {
  return /^changeme/i.test(value.trim())
}

/** AUTH_SECRET: present, not a CHANGEME placeholder, at least 32 bytes. */
export function authSecretProblem(value: string | undefined): string | null {
  if (!value || !value.trim()) return 'AUTH_SECRET is empty'
  if (isPlaceholder(value)) return 'AUTH_SECRET is a CHANGEME placeholder'
  if (Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES) {
    return `AUTH_SECRET must be at least ${MIN_SECRET_BYTES} bytes`
  }
  return null
}

/**
 * ENCRYPTION_KEY: the AES-256 key the provider decodes as hex, so it must be exactly 32 bytes
 * (64 hex characters). A key of any other length already fails at the first encrypt or decrypt.
 */
export function encryptionKeyProblem(value: string | undefined): string | null {
  if (!value || !value.trim()) return 'ENCRYPTION_KEY is empty'
  if (isPlaceholder(value)) return 'ENCRYPTION_KEY is a CHANGEME placeholder'
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    return 'ENCRYPTION_KEY must be 32 bytes, hex-encoded (64 hex characters)'
  }
  return null
}

/** APP_IDENTITY: present and not a placeholder (its format is checked where it is used). */
export function appIdentityProblem(value: string | undefined): string | null {
  if (!value || !value.trim()) return 'APP_IDENTITY is empty'
  if (isPlaceholder(value)) return 'APP_IDENTITY is a CHANGEME placeholder'
  return null
}

/** The problems found, without the values; empty when every secret is acceptable. */
export function secretProblems(
  env: Record<string, string | undefined>,
  options: { encryptionKey?: boolean } = {},
): string[] {
  return [
    authSecretProblem(env.AUTH_SECRET),
    appIdentityProblem(env.APP_IDENTITY),
    options.encryptionKey ? encryptionKeyProblem(env.ENCRYPTION_KEY) : null,
  ].filter((problem): problem is string => problem !== null)
}
