import type { Metadata } from 'next'
import { Suspense } from 'react'
import { GetAppName } from '@/actions/ApplicationSettings'
import PageHeader from '@igniter/ui/components/PageHeader'
import PageContent from '@igniter/ui/components/PageContent'
import { GetAnalyticsHeader, GetAnalyticsOptions, GetAnalyticsSummary } from '@/actions/Analytics'
import AnalyticsView, { type AnalyticsInitial } from './AnalyticsView'
import { filtersFromParams, filtersKey } from './params'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const appName = await GetAppName()
  return {
    title: `Analytics - ${appName}`,
  }
}

/**
 * Reads the first view on the server (options, then the header and the summary at once): from the browser, Next runs
 * server actions one after another, so the page would otherwise wait for four round trips in a row.
 */
async function firstView(searchParams: Record<string, string | string[] | undefined>): Promise<AnalyticsInitial> {
  const options = await GetAnalyticsOptions()
  if (!options.success) return {}
  const get = (k: string) => {
    const v = searchParams[k]
    return typeof v === 'string' ? v : null
  }
  const filters = filtersKey(filtersFromParams(get, options.data.defaultDays))
  const tab = get('tab')
  const [header, summary] = await Promise.all([
    GetAnalyticsHeader(filters),
    !tab || tab === 'summary' ? GetAnalyticsSummary(filters) : Promise.resolve(null),
  ])
  return {
    options: options.data,
    filters,
    header: header.success ? header.data : undefined,
    summary: summary?.success ? summary.data : undefined,
  }
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const initial = await firstView(await searchParams)
  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="What your suppliers earned in the sessions they were selected for, against an equal share of each session."
      />
      <PageContent>
        <Suspense>
          <AnalyticsView initial={initial} />
        </Suspense>
      </PageContent>
    </>
  )
}
