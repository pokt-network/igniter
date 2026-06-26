/**
 * Formats seconds into a human-readable duration string
 * Examples: "21d 3h", "5h 30m", "45m"
 */
export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  const parts: string[] = []

  if (days > 0) {
    parts.push(`${days}d`)
  }
  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0 && days === 0) {
    // Only show minutes if less than a day
    parts.push(`${minutes}m`)
  }

  return parts.length > 0 ? parts.join(' ') : '< 1m'
}

/**
 * Formats a timestamp as a compact "time ago" string relative to now.
 * Examples: "just now", "5m ago", "3h ago", "2d ago", then falls back to an
 * absolute short date for anything older than a week. Returns "—" for invalid input.
 */
export function formatRelativeTime(input: Date | string | number | null | undefined): string {
  if (input == null) return '—'
  const then = new Date(input).getTime()
  if (Number.isNaN(then)) return '—'

  const diffMs = Date.now() - then
  const sec = Math.floor(diffMs / 1000)
  if (sec < 45) return 'just now'

  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`

  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`

  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`

  return new Date(input).toLocaleDateString()
}
