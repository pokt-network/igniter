import 'server-only'
import { assertDnsAvailable, createGovernanceRegistry, governanceSourceUrl } from '@igniter/commons/governance'
import { getLogger } from '@igniter/logger'
import { assertSafeUrl, isOperatorTrustedHost } from '@igniter/notifications'
import { getApplicationSettings } from '@/lib/dal/applicationSettings'

const log = getLogger(['middleman', 'governance'])

/**
 * The url rule for a governance provider entry, the same as the middleman-workflows providers sync
 * (`urlError` in apps/middleman-workflows/src/lib/governance/providersSync.ts): https to a public
 * host, or plaintext http only to a host the operator trusts (NOTIFICATION_EGRESS_ALLOWLIST), which
 * is how localnet reaches the in-cluster provider. Returns the reason, or null.
 */
export async function providerUrlError(rawUrl: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'invalid url'
  }
  if (url.username || url.password) return 'url carries credentials'
  if (url.protocol === 'http:') {
    if (!(await isOperatorTrustedHost(url.hostname))) return 'url must be https'
  } else if (url.protocol !== 'https:') {
    return 'url must be https'
  }
  try {
    await assertSafeUrl(rawUrl)
  } catch (e) {
    return (e as Error).message
  }
  return null
}

/**
 * The governance source of providers for this server process (last-good cache, fail closed while
 * it has never been read). Provider calls take the url from here, never from the providers table.
 * An entry whose url breaks the rule above is left out, so it is treated as not listed.
 */
export const governance = createGovernanceRegistry({
  getSourceUrl: async () => {
    const template = process.env.PROVIDERS_CDN_URL
    if (!template) throw new Error('PROVIDERS_CDN_URL environment variable is not defined')
    const settings = await getApplicationSettings()
    return governanceSourceUrl(template, settings.chainId)
  },
  validateUrl: async (url) => {
    // A resolver failure (not a missing name) is transient: it fails the refresh, the last-good copy stays.
    if (URL.canParse(url)) await assertDnsAvailable(new URL(url).hostname)
    const reason = await providerUrlError(url)
    if (reason) log.warn('Governance provider url refused; the provider is left out', { url, reason })
    return reason
  },
})
