import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isSessionExpiredError } from '@/lib/sessionExpired'
import { signOutExpiredSession } from './sessionExpiredSignOut'

// Every poll on the page fails at once when the session expires; the sign-out
// itself runs once per page load, whoever starts it (this cache, the expiry timer
// or a call site). Cancelling aborts the in-flight requests and clearing drops
// the cached data, once per client; the redirect is what actually ends the polling.
export function sessionExpiredHandler(getClient: () => QueryClient) {
  let cleared = false
  return (error: unknown) => {
    if (!isSessionExpiredError(error)) return
    signOutExpiredSession()
    if (cleared) return
    cleared = true
    const client = getClient()
    void client.cancelQueries()
    client.clear()
  }
}

export function createQueryClient() {
  let client: QueryClient
  const onError = sessionExpiredHandler(() => client)
  client = new QueryClient({
    // A 401 will not heal by retrying, and the default 3 retries would delay
    // the sign-out by several seconds of failed polls.
    defaultOptions: {
      queries: { retry: (failureCount, error) => !isSessionExpiredError(error) && failureCount < 3 },
    },
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
  })
  return client
}
