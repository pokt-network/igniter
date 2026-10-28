'use client'

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import DetailHeader from '@igniter/ui/components/QuickDetails/Header'
import Summary from '@igniter/ui/components/Summary'
import Address from '@igniter/ui/components/Address'
import ErrorRetry from '@igniter/ui/components/ErrorRetry'
import { LoaderIcon } from '@igniter/ui/assets'
import { GetAnalyticsSession, type AnalyticsFilters } from '@/actions/Analytics'
import type { AnalyticsSessionRow } from '@/lib/dal/analytics'
import { unwrap } from '@/app/admin/(internal)/analytics/unwrap'
import { formatCount, formatDay, Pokt } from '@/app/admin/(internal)/analytics/format'
import { isFinal, phaseLabel } from '@/app/admin/(internal)/analytics/SessionsTab'

export interface AnalyticsSessionDetailItem {
  type: 'analyticsSession'
  /** The list row, and the page filters it was opened under: the drawer shows the same scope. */
  body: { row: AnalyticsSessionRow; filters: AnalyticsFilters }
}

const STATE_LABELS: Record<string, string> = {
  active: 'Active',
  paid: 'Paid',
  settled_zero: 'Settled for 0',
  expired: 'Claim expired',
  discarded: 'Claim discarded',
  slashed: 'Slashed',
  idle_others_worked: 'No claim, others did',
  idle_no_work: 'No work in the session',
  unresolved: 'Claim not resolved yet',
}

/**
 * One session: its totals, and your suppliers in its roster with what each got. Only your verified suppliers on the
 * page's services count, as in the list the session was opened from.
 */
export default function AnalyticsSessionDetail({ session, filters }: { session: AnalyticsSessionRow; filters: AnalyticsFilters }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics-session', session.sessionId, filters],
    queryFn: () => unwrap(GetAnalyticsSession(filters, session.sessionId)),
  })
  const s = data?.session ?? session
  const final = isFinal(s)
  const amount = (upokt: string | null) => (final ? <Pokt upokt={upokt ?? '0'} /> : <span className="text-text-tertiary">— not final yet</span>)

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader title="One recorded session" description="Indexed evidence in the current scope: your suppliers on the selected services, and the session totals." />
      <Summary
        rows={[
          { label: 'Service', value: s.serviceId },
          { label: 'UTC start', value: `${formatDay(s.day)}, block ${formatCount(s.startHeight)}` },
          { label: 'Session ID', value: <Address address={s.sessionId} /> },
          { label: 'Application', value: <Address address={s.applicationId} /> },
          { label: 'Candidates', value: formatCount(s.candidates), description: 'The staked suppliers of the service the roster was drawn from.' },
          { label: 'Selected positions / yours', value: `${formatCount(s.rosterSize)} / ${formatCount(s.members)}` },
          { label: 'Total supplier payout pool', value: amount(s.poolUpokt), description: 'What the session paid every member of its roster. Final once it settles with its money.' },
          { label: 'Equal-share amount (yours)', value: amount(s.equalShareUpokt), description: 'The pool split evenly over the roster, for your seats.' },
          { label: 'Actual gross earnings (yours)', value: amount(s.paidUpokt) },
          { label: 'Payout status', value: phaseLabel(s) },
          { label: 'Money indexed', value: s.moneyMissing ? 'Not yet' : 'Yes' },
        ]}
      />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Your suppliers in this session</p>
        {isError ? <ErrorRetry onRetry={() => refetch()} /> : isLoading ? (
          <div className="flex justify-center py-6"><LoaderIcon className="animate-spin" /></div>
        ) : !data ? (
          <p className="text-sm text-text-tertiary">None of your suppliers on the selected services is in this session.</p>
        ) : (
          <Summary
            rows={data.members.map((m) => ({
              label: <Address address={m.supplierId} />,
              value: (
                <span className="flex flex-col items-end text-sm">
                  <span>{STATE_LABELS[m.state] ?? m.state}</span>
                  {final && (
                    <span className="text-xs text-text-tertiary">
                      paid <Pokt upokt={m.paidUpokt} />, equal share <Pokt upokt={m.equalShareUpokt} />
                    </span>
                  )}
                </span>
              ),
            }))}
          />
        )}
      </div>
    </div>
  )
}
