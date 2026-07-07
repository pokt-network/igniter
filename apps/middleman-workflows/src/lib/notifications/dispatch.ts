import { randomUUID } from 'crypto'
import { dispatchToChannels } from '@igniter/notifications'
import type { DispatchChannel, ChannelDeliveryResult } from '@igniter/notifications'
import { DEFAULT_NOTIFICATION_FLAGS } from '@igniter/db/middleman/schema'
import type { NotificationEventType } from '@igniter/db/middleman/schema'
import type DAL from '@/lib/dal/DAL'
import { buildNotificationMessage } from './messageBuilder'

// Minimal structural logger so this works with both the Temporal activity `log`
// and @igniter/logger's Logger (their concrete types differ).
interface DispatchLogger {
  info(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export interface UserNotificationEvent {
  type: NotificationEventType
  // The wallet that owns the affected record — its channels receive the event.
  ownerIdentity: string
  metadata: Record<string, unknown>
}

// Owner-keyed delivery (the core difference from the provider's instance-wide
// dispatch): load the affected wallet's enabled channels subscribed to this
// event type, build the message, send via the shared transports, and persist the
// event for the in-app feed. Best-effort — delivery failures are recorded per
// channel and the whole thing never throws into the calling workflow/activity.
export async function dispatchUserNotification(
  dal: DAL,
  logger: DispatchLogger,
  event: UserNotificationEvent,
): Promise<void> {
  const uuid = randomUUID()

  // External delivery is attempted in its own try so that a channel-load/decrypt
  // failure (e.g. a bad NOTIFICATION_ENCRYPTION_KEY) or a transport error still falls through
  // to persisting the event — the in-app feed is independent of external delivery
  // and must show the event even when no channels resolve.
  let results: ChannelDeliveryResult[] = []
  try {
    const all = await dal.notifications.loadEnabledChannelsForOwner(event.ownerIdentity)
    const channels = all.filter((c) => {
      const flags = { ...DEFAULT_NOTIFICATION_FLAGS, ...(c.notificationFlags ?? {}) }
      return flags[event.type] ?? false
    })

    // Deliver only if the owner configured any subscribed channels.
    if (channels.length > 0) {
      const message = buildNotificationMessage(event.type, event.metadata, { uuid })
      // Middleman email channels carry their own SMTP in config (per-user), so no
      // shared transporter — each EmailChannel builds its own from config.smtp.
      const dispatchable: DispatchChannel[] = channels.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type as DispatchChannel['type'],
        config: c.config as DispatchChannel['config'],
      }))
      results = await dispatchToChannels(dispatchable, message)
    }
  } catch (err) {
    logger.error('dispatchUserNotification: channel delivery failed', { err, type: event.type })
  }

  // Persist regardless of delivery outcome (best-effort — never throws into the
  // calling activity/workflow).
  try {
    await dal.notifications.insertEvent({
      uuid,
      type: event.type,
      createdBy: event.ownerIdentity,
      metadata: event.metadata,
      channels: results,
    })

    logger.info('dispatchUserNotification: done', {
      type: event.type,
      owner: event.ownerIdentity,
      channels: results.length,
      errors: results.filter((r) => r.status === 'error').length,
    })
  } catch (err) {
    logger.error('dispatchUserNotification: failed to persist event', { err, type: event.type })
  }
}
