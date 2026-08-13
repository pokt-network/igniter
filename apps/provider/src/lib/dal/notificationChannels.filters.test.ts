jest.mock('@/db', () => ({ getDb: () => ({}) }))

import { buildNotificationEventFilterConditions } from './notificationChannels'

// The helper turns the optional filter set into AND-able SQL conditions. These
// tests lock the branching (each active filter contributes exactly one
// condition; absent/empty filters contribute none) so a future refactor can't
// silently drop a filter dimension.
describe('buildNotificationEventFilterConditions (provider)', () => {
  it('produces no conditions when nothing is filtered', () => {
    expect(buildNotificationEventFilterConditions(undefined)).toHaveLength(0)
    expect(buildNotificationEventFilterConditions({})).toHaveLength(0)
  })

  it('adds exactly one condition per active filter dimension', () => {
    expect(buildNotificationEventFilterConditions({ type: 'keys_staked' })).toHaveLength(1)
    expect(buildNotificationEventFilterConditions({ read: 'unread' })).toHaveLength(1)
    expect(buildNotificationEventFilterConditions({ read: 'read' })).toHaveLength(1)
    expect(buildNotificationEventFilterConditions({ channel: 'telegram' })).toHaveLength(1)
    expect(buildNotificationEventFilterConditions({ search: 'abc' })).toHaveLength(1)
  })

  it('ignores an empty/unknown read value', () => {
    expect(
      buildNotificationEventFilterConditions({ read: '' as unknown as 'read' }),
    ).toHaveLength(0)
  })

  it('ignores empty-string filter values (treated as unconstrained)', () => {
    expect(
      buildNotificationEventFilterConditions({ type: '', channel: '', search: '' }),
    ).toHaveLength(0)
  })

  it('ignores an unknown event type instead of shipping it to the enum column', () => {
    expect(buildNotificationEventFilterConditions({ type: 'not_a_real_type' })).toHaveLength(0)
  })

  it('combines every active filter into four ANDable conditions', () => {
    expect(
      buildNotificationEventFilterConditions({
        type: 'keys_staked',
        read: 'unread',
        channel: 'telegram',
        search: 'x',
      }),
    ).toHaveLength(4)
  })
})
