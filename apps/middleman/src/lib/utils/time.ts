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
