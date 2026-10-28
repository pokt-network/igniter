jest.mock('server-only', () => ({}))

type Query = { text: string; values: unknown[] }
const queries: Query[] = []
let answer: (text: string) => Record<string, unknown>[] = () => []

jest.mock('@/db', () => {
  const { drizzle } = jest.requireActual('drizzle-orm/node-postgres')
  const client = {
    query: async (q: string | { text: string }, values?: unknown[]) => {
      const text = typeof q === 'string' ? q : q.text
      queries.push({ text, values: values ?? [] })
      return { rows: answer(text), rowCount: 0, fields: [] }
    },
  }
  const db = drizzle(client as never)
  return { getDb: () => db }
})

import { analyticsBreakdown, getAnalyticsSession, listAnalyticsSessions, type AnalyticsFilter } from '@/lib/dal/analytics'

const filter = (over: Partial<AnalyticsFilter> = {}): AnalyticsFilter => ({
  from: '2026-10-01',
  to: '2026-10-07',
  services: null,
  suppliers: ['pokt1mine'],
  wholeSessions: false,
  ...over,
})

const sessionRow = {
  session_id: 's1', day: '2026-10-02', start_height: 10, service_id: 'eth', application_id: 'pokt1app', phase: 'settled',
  money_missing: false, roster_size: 50, candidates: 4000, v: '100', x: 1, y: '3', b: '2',
}

beforeEach(() => {
  queries.length = 0
  answer = () => []
})

describe('Analytics page DAL: members are scoped to the verified suppliers of the page', () => {
  it('reads a session\'s members and totals only for the scope\'s suppliers', async () => {
    answer = (text) => (text.includes('cross join lateral') ? [sessionRow] : [])
    await getAnalyticsSession(filter(), 's1')
    expect(queries).toHaveLength(2)
    for (const q of queries) {
      expect(q.text).toMatch(/m\.supplier_id = any\(\$\d+::text\[\]\)/)
      expect(q.values).toContainEqual(['pokt1mine'])
    }
  })

  it('returns null for a session with no member in scope', async () => {
    answer = (text) => (text.includes('cross join lateral') ? [{ ...sessionRow, x: 0, y: null, b: null }] : [])
    expect(await getAnalyticsSession(filter(), 's1')).toBeNull()
  })

  it('lists only sessions with a member in scope, and their scoped totals', async () => {
    await listAnalyticsSessions(filter(), { offset: 0, limit: 25, phase: 'all' })
    expect(queries).toHaveLength(2)
    for (const q of queries) {
      expect(q.text).toContain('exists (select 1 from analytics_session_member m where m.session_id = s.session_id')
      expect(q.values).toContainEqual(['pokt1mine'])
    }
  })

  it('filters the list by phase', async () => {
    await listAnalyticsSessions(filter(), { offset: 0, limit: 25, phase: 'in_progress' })
    expect(queries[0]!.text).toContain("s.phase <> 'settled'")
    queries.length = 0
    await listAnalyticsSessions(filter(), { offset: 0, limit: 25, phase: 'money_missing' })
    expect(queries[0]!.text).toContain("s.phase = 'settled' and s.money_missing")
    queries.length = 0
    await listAnalyticsSessions(filter(), { offset: 0, limit: 25, phase: 'settled' })
    expect(queries[0]!.text).toContain("s.phase = 'settled' and not s.money_missing")
  })
})

describe('Analytics page DAL: owner sessions', () => {
  it('counts a stale day once: from its member rows, never from its old rollup too', async () => {
    answer = (text) => (text.includes('analytics_day_rollup') ? [{ day: '2026-10-07' }] : [])
    await analyticsBreakdown(filter({ wholeSessions: true }), 'owner')
    // The shared stale-day rule, as readers use it: a syncing day is stale whatever its age.
    expect(queries[0]!.text).toContain('select distinct day from analytics_session')
    expect(queries[0]!.text).not.toContain('r.built_at < now()')
    const main = queries[1]!
    // The rollup leaves the stale day out...
    expect(main.text).toMatch(/from analytics_owner_day o[\s\S]*and not \(o\.day = any\(\$\d+::date\[\]\)\)/)
    // ...and the member rows count only that day.
    expect(main.text).toContain('m.day = any(')
    expect(main.values.filter((v) => JSON.stringify(v) === JSON.stringify(['2026-10-07']))).toHaveLength(2)
  })

  it('reads only the rollup when no day is stale', async () => {
    await analyticsBreakdown(filter({ wholeSessions: true }), 'owner')
    expect(queries[1]!.text).toContain('from analytics_owner_day o')
    expect(queries[1]!.text).not.toContain('analytics_session_member')
  })

  it('counts from the member rows alone when stored rows hold suppliers outside the scope', async () => {
    await analyticsBreakdown(filter({ wholeSessions: false }), 'owner')
    expect(queries).toHaveLength(1)
    expect(queries[0]!.text).not.toContain('analytics_owner_day')
    expect(queries[0]!.text).toContain('count(distinct m.session_id)')
  })
})

describe('Analytics page DAL: weeks', () => {
  it('group days in 7-day blocks from the period\'s first day, as the Summary chart does (not ISO weeks)', async () => {
    answer = (text) => (text.includes('with money') ? [{ g: '2026-10-01', y: '1', b: '1', days: 7, sessions: 3 }] : [])
    const groups = await analyticsBreakdown(filter({ from: '2026-10-01', to: '2026-10-09' }), 'week')
    const main = queries.find((q) => q.text.includes('with money'))!
    expect(main.text).toMatch(/\(\$\d+::date \+ \(\(d\.day - \$\d+::date\) \/ 7\) \* 7\)::text/)
    expect(main.text).not.toContain('isodow')
    expect(main.values.filter((v) => v === '2026-10-01').length).toBeGreaterThanOrEqual(2)
    expect(groups.map((g) => g.key)).toEqual(['2026-10-01'])
  })
})

describe('Analytics page DAL: per-session breakdowns', () => {
  it('read the day rebuild\'s own_* columns of analytics_session, without the member rows, when every day is rebuilt', async () => {
    for (const dim of ['application', 'selected', 'value'] as const) {
      queries.length = 0
      await analyticsBreakdown(filter({ wholeSessions: true, services: ['eth'] }), dim)
      const main = queries[1]!
      expect(main.text).toContain('s.own_members as x')
      expect(main.text).not.toContain('analytics_session_member')
      expect(main.values).toContainEqual(['eth'])
    }
  })

  it('band session value in four ntiles, a settled session without V as no_payout, an unsettled one as not_settled', async () => {
    await analyticsBreakdown(filter({ wholeSessions: true }), 'value')
    const main = queries[1]!.text.replace(/\s+/g, ' ')
    expect(main).toContain("s.phase = 'settled' as settled")
    expect(main).toContain("case when v is not null then (ntile(4) over (partition by v is null order by v))::text when settled then 'no_payout' else 'not_settled' end as band")
  })

  it('count a stale day (no current rollup) from its member rows only', async () => {
    answer = (text) => (text.includes('analytics_day_rollup') ? [{ day: '2026-10-07' }] : [])
    await analyticsBreakdown(filter({ wholeSessions: true }), 'selected')
    const main = queries[1]!
    expect(main.text).toContain('not (s.day = any(')
    expect(main.text).toContain('from analytics_session_member m')
    expect(main.values).toContainEqual(['2026-10-07'])
  })
})
