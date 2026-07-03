import type { WorkflowExecutionInfo, ScheduleSummary, Client } from '@temporalio/client'
import {
  mapWorkflowInfoToView,
  matchesWorkflowFilter,
  buildWorkflowListQuery,
  listWorkflowViews,
  mapScheduleToHealth,
  type WorkflowView,
  type WatchdogHealState,
} from './workflowView'

function makeInfo(over: Partial<WorkflowExecutionInfo> = {}): WorkflowExecutionInfo {
  return {
    type: 'ExecuteTransaction',
    workflowId: 'wf-1',
    runId: 'run-1',
    taskQueue: 'provider-operations',
    status: { code: 1 as never, name: 'RUNNING' },
    historyLength: 5,
    startTime: new Date('2026-07-01T00:00:00.000Z'),
    searchAttributes: {},
    raw: {} as never,
    ...over,
  } as WorkflowExecutionInfo
}

// Minimal async-iterable stub mirroring client.workflow.list() semantics.
function makeClient(infos: WorkflowExecutionInfo[], opts: { rejectQuery?: boolean } = {}): Client {
  return {
    workflow: {
      list(listOpts?: { query?: string }) {
        if (opts.rejectQuery && listOpts?.query) {
          throw new Error('InvalidArgument: query not supported by basic visibility')
        }
        return {
          async *[Symbol.asyncIterator]() {
            for (const i of infos) yield i
          },
        }
      },
    },
  } as unknown as Client
}

describe('mapWorkflowInfoToView', () => {
  it('maps a running workflow: elapsed measured from now, closeTime null', () => {
    const now = new Date('2026-07-01T00:00:10.000Z').getTime()
    const view = mapWorkflowInfoToView(makeInfo(), now)
    expect(view).toEqual<WorkflowView>({
      workflowId: 'wf-1',
      runId: 'run-1',
      type: 'ExecuteTransaction',
      status: 'RUNNING',
      startTime: '2026-07-01T00:00:00.000Z',
      closeTime: null,
      elapsedMs: 10_000,
      scheduledById: null,
    })
  })

  it('maps a terminal workflow: elapsed from start to closeTime', () => {
    const view = mapWorkflowInfoToView(
      makeInfo({
        status: { code: 2 as never, name: 'COMPLETED' },
        closeTime: new Date('2026-07-01T00:00:05.000Z'),
      }),
      Date.now(),
    )
    expect(view.status).toBe('COMPLETED')
    expect(view.closeTime).toBe('2026-07-01T00:00:05.000Z')
    expect(view.elapsedMs).toBe(5_000)
  })
})

describe('buildWorkflowListQuery / matchesWorkflowFilter', () => {
  it('builds ExecutionStatus + WorkflowType clauses', () => {
    expect(buildWorkflowListQuery({ status: 'RUNNING', type: 'ExecuteTransaction' })).toBe(
      'ExecutionStatus = "Running" AND WorkflowType = "ExecuteTransaction"',
    )
  })

  it('scope=running maps to Running when no explicit status', () => {
    expect(buildWorkflowListQuery({ scope: 'running' })).toBe('ExecutionStatus = "Running"')
  })

  it('returns undefined when nothing to filter', () => {
    expect(buildWorkflowListQuery({ status: 'ALL', scope: 'all' })).toBeUndefined()
  })

  it('client-side predicate honors status/type/scope', () => {
    const running = mapWorkflowInfoToView(makeInfo(), Date.now())
    expect(matchesWorkflowFilter(running, { status: 'RUNNING' })).toBe(true)
    expect(matchesWorkflowFilter(running, { status: 'FAILED' })).toBe(false)
    expect(matchesWorkflowFilter(running, { type: 'Other' })).toBe(false)
    expect(matchesWorkflowFilter(running, { scope: 'running' })).toBe(true)
  })
})

describe('listWorkflowViews', () => {
  const infos = Array.from({ length: 5 }, (_, i) =>
    makeInfo({ workflowId: `wf-${i}`, runId: `run-${i}` }),
  )

  it('returns a page window and hasMore + synthesized total', async () => {
    const now = new Date('2026-07-01T00:00:10.000Z').getTime()
    const res = await listWorkflowViews(makeClient(infos), {}, { pageIndex: 0, pageSize: 2 }, now)
    expect(res.items.map((v) => v.workflowId)).toEqual(['wf-0', 'wf-1'])
    expect(res.hasMore).toBe(true)
    // pageIndex*size + items + (hasMore ? size : 0) = 0 + 2 + 2 = 4
    expect(res.total).toBe(4)
  })

  it('honors pageIndex offset and reports last page', async () => {
    const now = Date.now()
    const res = await listWorkflowViews(makeClient(infos), {}, { pageIndex: 2, pageSize: 2 }, now)
    expect(res.items.map((v) => v.workflowId)).toEqual(['wf-4'])
    expect(res.hasMore).toBe(false)
    // 2*2 + 1 + 0 = 5
    expect(res.total).toBe(5)
  })

  it('falls back to unfiltered list + client-side filter when the backend rejects the query', async () => {
    const now = Date.now()
    const mixed = [
      makeInfo({ workflowId: 'r', status: { code: 1 as never, name: 'RUNNING' } }),
      makeInfo({ workflowId: 'f', status: { code: 3 as never, name: 'FAILED' } }),
    ]
    const res = await listWorkflowViews(
      makeClient(mixed, { rejectQuery: true }),
      { status: 'FAILED' },
      { pageIndex: 0, pageSize: 10 },
      now,
    )
    expect(res.items.map((v) => v.workflowId)).toEqual(['f'])
  })
})

describe('mapScheduleToHealth', () => {
  function makeSummary(over: Partial<ScheduleSummary> = {}): ScheduleSummary {
    return {
      scheduleId: 'GovernanceSync-scheduled',
      state: { paused: false },
      info: {
        recentActions: [
          { scheduledAt: new Date('2026-07-01T00:00:00Z'), takenAt: new Date('2026-07-01T00:00:00Z'), action: {} as never },
          { scheduledAt: new Date('2026-07-01T00:05:00Z'), takenAt: new Date('2026-07-01T00:05:00Z'), action: {} as never },
        ],
        nextActionTimes: [new Date('2026-07-01T00:10:00Z')],
      },
      ...over,
    } as ScheduleSummary
  }

  const heal = (over: Partial<WatchdogHealState> = {}): WatchdogHealState => ({
    scheduleId: 'GovernanceSync-scheduled',
    attempts: 0,
    injectedTriggers: 0,
    lastHealTriggerAt: null,
    lastActionCount: 0,
    unhealthy: false,
    observedUnhealthy: false,
    recreations: 0,
    lastRecreatedAt: null,
    ...over,
  })

  it('healthy when not paused and no heal escalation', () => {
    const row = mapScheduleToHealth(makeSummary(), heal())
    expect(row.state).toBe('healthy')
    expect(row.lastFire).toBe('2026-07-01T00:05:00.000Z')
    expect(row.nextFire).toBe('2026-07-01T00:10:00.000Z')
  })

  it('paused wins over everything', () => {
    expect(mapScheduleToHealth(makeSummary({ state: { paused: true } }), heal({ unhealthy: true })).state).toBe('paused')
  })

  it('unhealthy flag surfaces (also honors observed_unhealthy)', () => {
    expect(mapScheduleToHealth(makeSummary(), heal({ unhealthy: true })).state).toBe('unhealthy')
    expect(mapScheduleToHealth(makeSummary(), heal({ observedUnhealthy: true })).state).toBe('unhealthy')
  })

  it('stale when attempts>0 but not yet unhealthy', () => {
    expect(mapScheduleToHealth(makeSummary(), heal({ attempts: 2 })).state).toBe('stale')
  })

  it('degrades to healthy with zeroed health when no watchdog row', () => {
    const row = mapScheduleToHealth(makeSummary(), null)
    expect(row.state).toBe('healthy')
    expect(row.attempts).toBe(0)
    expect(row.unhealthy).toBe(false)
    expect(row.recreations).toBe(0)
    expect(row.lastRecreatedAt).toBeNull()
  })

  it('passes recreations and lastRecreatedAt through from the heal row', () => {
    const row = mapScheduleToHealth(makeSummary(), heal({ recreations: 3, lastRecreatedAt: '2026-07-02T10:00:00.000Z' }))
    expect(row.recreations).toBe(3)
    expect(row.lastRecreatedAt).toBe('2026-07-02T10:00:00.000Z')
  })

  it('maps recentActions to fire views with lag, most recent last', () => {
    const row = mapScheduleToHealth(
      makeSummary({
        info: {
          recentActions: [
            {
              scheduledAt: new Date('2026-07-02T10:00:00Z'),
              takenAt: new Date('2026-07-02T10:00:04Z'),
              action: {
                type: 'startWorkflow',
                workflow: {
                  workflowId: 'S-scheduled-workflow-2026-07-02T10:00:00Z',
                  firstExecutionRunId: 'run-9',
                },
              },
            },
          ],
          nextActionTimes: [],
        },
      }),
      null,
    )
    expect(row.recentFires).toEqual([
      {
        scheduledAt: '2026-07-02T10:00:00.000Z',
        takenAt: '2026-07-02T10:00:04.000Z',
        lagMs: 4000,
        workflowId: 'S-scheduled-workflow-2026-07-02T10:00:00Z',
        firstExecutionRunId: 'run-9',
      },
    ])
  })

  it('defaults recentFires to an empty array without recentActions', () => {
    const row = mapScheduleToHealth(
      makeSummary({ info: { recentActions: [], nextActionTimes: [] } }),
      null,
    )
    expect(row.recentFires).toEqual([])
  })
})

describe('scheduledById on WorkflowView', () => {
  it('extracts TemporalScheduledById[0] from list-item searchAttributes', () => {
    const info = makeInfo({
      searchAttributes: { TemporalScheduledById: ['S-scheduled'] },
    })
    expect(mapWorkflowInfoToView(info).scheduledById).toBe('S-scheduled')
  })

  it('defaults to null without the attribute', () => {
    expect(mapWorkflowInfoToView(makeInfo()).scheduledById).toBeNull()
  })
})

describe('scheduledBy filter', () => {
  it('adds TemporalScheduledById clause to the server query', () => {
    expect(buildWorkflowListQuery({ scheduledBy: 'GovernanceSync-scheduled' })).toBe(
      `TemporalScheduledById = 'GovernanceSync-scheduled'`,
    )
  })

  it('combines with status/type clauses via AND', () => {
    const q = buildWorkflowListQuery({ status: 'RUNNING', scheduledBy: 'S-scheduled' })
    expect(q).toContain('ExecutionStatus = "Running"')
    expect(q).toContain(`TemporalScheduledById = 'S-scheduled'`)
    expect(q).toContain(' AND ')
  })

  it('client-side fallback matches by workflowId prefix', () => {
    const view = mapWorkflowInfoToView(
      makeInfo({ workflowId: 'S-scheduled-workflow-2026-07-02T10:00:00Z' }),
      Date.now(),
    )
    expect(matchesWorkflowFilter(view, { scheduledBy: 'S-scheduled' })).toBe(true)
    expect(matchesWorkflowFilter(view, { scheduledBy: 'Other-scheduled' })).toBe(false)
  })
})
