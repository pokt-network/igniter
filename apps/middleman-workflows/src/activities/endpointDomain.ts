// The "domain" of an endpoint, by the same rule pocketdex uses for the `domains` it stores on each
// supplier service config (pocketdex src/mappings/utils/service_config_history.ts endpointDomain),
// which getSupplierFleetList(domains) and getRewardsByDomainsAndTimeGroupByService match exactly: a
// different rule here finds nothing there. An IPv4 host is the whole address; an IPv6 host its
// compressed lowercase form, an IPv4-mapped one as ::ffff:a.b.c.d; a hostname its last two labels.
// A public suffix such as co.uk is not known on either side (pocketdex stores x.foo.co.uk as co.uk);
// moving to the Public Suffix List has to happen in pocketdex first, with its stored domains rewritten.

/** The domain of one endpoint URL, or null when none can be read; never throws. */
export function endpointDomain(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const raw = url.trim()
  if (raw === '') return null
  let host: string | undefined
  try {
    host = new URL(raw).hostname
  } catch {
    // not a WHATWG URL (e.g. an unbracketed IPv6 or a space in the host): read the authority after the scheme
    const authority = raw.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#\s]+)/i)?.[1]
    // more than one colon and no brackets: an IPv6 address, whose port cannot be told apart; else host[:port]
    host = authority !== undefined && !authority.startsWith('[') && (authority.match(/:/g) ?? []).length > 1
      ? authority
      : authority?.match(/^(\[[^\]]*\]|[^:]+)/)?.[1]
  }
  if (!host) return null
  host = host.toLowerCase().replace(/\.+$/, '')
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === '') return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((octet) => Number(octet) <= 255) ? host : null
  }
  if (host.includes(':')) return ipv6(host)
  const labels = host.split('.').filter((label) => label !== '')
  return labels.length >= 2 ? labels.slice(-2).join('.') : labels[0] ?? null
}

/** The domain of a bare host (a relay miner's domain), read as the host of an https URL. */
export function hostDomain(host: string): string | null {
  return endpointDomain(/^[a-z][a-z0-9+.-]*:\/\//i.test(host.trim()) ? host : `https://${host.trim()}`)
}

// An IPv6 address in compressed lowercase form (WHATWG's serializer), IPv4-mapped as ::ffff:a.b.c.d; null if invalid
function ipv6(address: string): string | null {
  let compressed: string
  try {
    compressed = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  } catch {
    return null
  }
  const mapped = compressed.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!mapped) return compressed
  const [hi, lo] = [parseInt(mapped[1]!, 16), parseInt(mapped[2]!, 16)]
  return `::ffff:${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}
