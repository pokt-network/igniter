import { getCompressedPublicKeyFromAppIdentity } from '@igniter/commons/crypto'
import { getLogger } from '@igniter/logger'

const log = getLogger(['provider', 'identity'])

// Never cached: the response must always reflect the key the running instance
// currently holds, not one captured at build time or by an upstream proxy.
export const dynamic = 'force-dynamic'

/**
 * Public identity attestation endpoint.
 *
 * Returns the compressed secp256k1 public key derived from the `APP_IDENTITY`
 * private key in the environment — the same value published as `identity` in the
 * governance registry. Governance CI fetches `<registry url>/api/identity` and
 * compares it against the identity declared in the pull request, which proves the
 * operator deployed an Igniter instance configured with the key they registered.
 *
 * The key is derived per request rather than read from `application_settings`, so
 * the response cannot go stale after an `APP_IDENTITY` rotation and does not depend
 * on the database or on bootstrap having completed. Whether the instance is
 * operational is a separate question, answered by `/api/health`.
 *
 * Unauthenticated by design: the value is a public key already published in the
 * governance repository.
 */
export async function GET() {
  let identity: string

  try {
    identity = (await getCompressedPublicKeyFromAppIdentity()).toString('hex')
  } catch (e) {
    log.error('Failed to derive app identity from APP_IDENTITY.', { error: e })
    return new Response(JSON.stringify({ error: 'Identity unavailable' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  }

  return new Response(JSON.stringify({ identity }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      // Public data — allows a browser-based governance checker to read it.
      'Access-Control-Allow-Origin': '*',
    },
  })
}
