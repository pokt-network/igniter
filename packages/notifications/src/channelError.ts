// A delivery failure with a coarse, safe-to-surface category so callers (the
// Add/Edit-channel test-send, the dispatch results table) can tell a permanent
// misconfiguration (bad/revoked webhook, wrong bot token) from a transient blip
// — WITHOUT reflecting the provider's response BODY, which would turn the guard
// into a read-oracle for probed endpoints. Only the status class is exposed.

export type ChannelErrorCategory =
  | 'auth' // credentials rejected (bad token / SMTP auth)
  | 'not_found' // destination missing (deleted/typo'd webhook)
  | 'rate_limited' // throttled — retry later
  | 'invalid_request' // request rejected (bad chat id / recipient)
  | 'blocked' // egress guard refused the destination
  | 'transient' // network / 5xx / timeout — retry later

const CATEGORY_TEXT: Record<ChannelErrorCategory, string> = {
  auth: 'authentication was rejected — check the credentials',
  not_found: 'the destination was not found — check the URL/token',
  rate_limited: 'the destination is rate limiting — try again later',
  invalid_request: 'the request was rejected — check the configuration',
  blocked: 'the destination address is not allowed',
  transient: 'a temporary delivery error occurred — try again',
}

const CHANNEL_LABEL: Record<string, string> = {
  discord: 'Discord webhook',
  telegram: 'Telegram',
  email: 'Email',
}

export class ChannelDeliveryError extends Error {
  readonly channel: string
  readonly category: ChannelErrorCategory
  readonly statusCode?: number

  constructor(channel: string, category: ChannelErrorCategory, opts: { statusCode?: number; message?: string } = {}) {
    const label = CHANNEL_LABEL[channel] ?? channel
    const status = opts.statusCode ? ` (HTTP ${opts.statusCode})` : ''
    super(opts.message ?? `${label} delivery failed: ${CATEGORY_TEXT[category]}${status}`)
    this.name = 'ChannelDeliveryError'
    this.channel = channel
    this.category = category
    this.statusCode = opts.statusCode
  }

  /** Whether a retry could plausibly succeed without a config change. */
  get retriable(): boolean {
    return this.category === 'transient' || this.category === 'rate_limited'
  }
}

/** Map an HTTP status to a category. 5xx and anything unexpected → transient. */
export function categorizeHttpStatus(status: number): ChannelErrorCategory {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404 || status === 410) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 400 && status < 500) return 'invalid_request'
  return 'transient'
}