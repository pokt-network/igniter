import type { AnalyticsFilters } from '@/actions/Analytics'

/** A UTC day in a URL parameter. */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The page's filters from its URL parameters, the same on the server (first render) and in the browser: the last N
 * days (`days`, else `defaultDays`), or a custom `from`/`to` range when both are valid days; and the `services`.
 */
export function filtersFromParams(get: (name: string) => string | null, defaultDays: number): AnalyticsFilters & { custom: boolean } {
  const from = get('from')
  const to = get('to')
  const custom = !!from && !!to && DAY_RE.test(from) && DAY_RE.test(to)
  const services = (get('services') ?? '').split(',').filter(Boolean)
  return {
    days: Number(get('days')) || defaultDays,
    from: custom ? from : null,
    to: custom ? to : null,
    services: services.length ? services : null,
    custom,
  }
}

/** The query key part of the filters (without `custom`, which only the controls use). */
export const filtersKey = ({ days, from, to, services }: AnalyticsFilters): AnalyticsFilters => ({ days, from, to, services })
