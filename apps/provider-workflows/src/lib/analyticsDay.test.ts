import { ANALYTICS_DAY_BUSY_ATTEMPTS, analyticsDayWorkflowId, onAnalyticsDayBusy } from '@/lib/analyticsDay'

describe('one sync of a day at a time', () => {
  it('gives the scheduled sync and the backfill the same id for a day, so Temporal refuses the second', () => {
    expect(analyticsDayWorkflowId('2026-10-20')).toBe('AnalyticsSyncDay-2026-10-20')
    expect(analyticsDayWorkflowId('2026-10-20')).not.toBe(analyticsDayWorkflowId('2026-10-21'))
  })

  it('the sync skips a day the backfill is syncing', () => {
    expect(onAnalyticsDayBusy('sync', 1)).toBe('skip')
  })

  it('the backfill waits for a day the sync is syncing, then gives it up', () => {
    expect(onAnalyticsDayBusy('backfill', 1)).toBe('wait')
    expect(onAnalyticsDayBusy('backfill', ANALYTICS_DAY_BUSY_ATTEMPTS - 1)).toBe('wait')
    expect(onAnalyticsDayBusy('backfill', ANALYTICS_DAY_BUSY_ATTEMPTS)).toBe('give_up')
  })
})
