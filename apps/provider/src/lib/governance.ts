import 'server-only'
import { createGovernanceRegistry, governanceSourceUrl } from '@igniter/commons/governance'
import { getApplicationSettings } from '@/lib/dal/applicationSettings'

/**
 * The middleman governance file (DELEGATORS_CDN_URL): the middlemen allowed to call this provider.
 * One registry per server process, so the last-good copy is shared by every request.
 * The delegators file lists identities only, hence requireUrl: false.
 */
export const delegatorsGovernance = createGovernanceRegistry({
  requireUrl: false,
  getSourceUrl: async () => {
    const template = process.env.DELEGATORS_CDN_URL
    if (!template) {
      throw new Error('DELEGATORS_CDN_URL environment variable is not defined')
    }
    const { chainId } = await getApplicationSettings()
    return governanceSourceUrl(template, chainId)
  },
})
