import crypto from 'crypto'
import {
  boolean,
  customType,
  integer,
  json,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { usersTable } from './users'
import {
  notificationChannelTypeEnum,
  notificationEventTypeEnum,
  NOTIFICATION_EVENT_TYPES,
  NotificationChannelType,
} from './enums'

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export type NotificationFlags = Record<NotificationEventType, boolean>

export const DEFAULT_NOTIFICATION_FLAGS: NotificationFlags = {
  service_change: true,
  revshare_change: true,
  stake: true,
  unstake: true,
  upstake: true,
  operational_funds: true,
  import_result: true,
}

// Channel secrets (webhook URL, bot token, and — for middleman's per-user email
// — the full SMTP credentials) are stored encrypted at rest with AES-256-CBC
// keyed by NOTIFICATION_ENCRYPTION_KEY; the whole config JSON is encrypted, so the SMTP
// password rides inside it. A random per-record IV is used, so identical
// secrets don't encrypt identically.
const algorithm = 'aes-256-cbc'

function encrypt(text: string): string {
  const key = Buffer.from(process.env.NOTIFICATION_ENCRYPTION_KEY!, 'hex')
  // Random per-record IV. A fixed/reused IV makes AES-256-CBC deterministic and
  // leaks plaintext equality. decrypt() reads the IV from the stored "iv:cipher"
  // prefix, so rows stay self-describing.
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

function decrypt(text: string): string {
  const key = Buffer.from(process.env.NOTIFICATION_ENCRYPTION_KEY!, 'hex')
  const textParts = text.split(':')
  const iv = Buffer.from(textParts.shift()!, 'hex')
  const encryptedText = Buffer.from(textParts.join(':'), 'hex')
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  let decrypted = decipher.update(encryptedText, undefined, 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

const encryptedJson = customType<{ data: NotificationChannelConfig }>({
  dataType() {
    return 'text'
  },
  fromDriver(value: unknown) {
    const raw = value as string
    // Encrypted rows are "ivHex:cipherHex"; anything else is treated as legacy
    // plaintext JSON. A genuine decryption failure (wrong NOTIFICATION_ENCRYPTION_KEY) fails
    // loudly instead of silently parsing ciphertext as JSON.
    if (!/^[0-9a-f]+:[0-9a-f]+$/i.test(raw)) {
      return JSON.parse(raw)
    }
    try {
      return JSON.parse(decrypt(raw))
    } catch {
      throw new Error('Failed to decrypt notification channel config (check NOTIFICATION_ENCRYPTION_KEY)')
    }
  },
  toDriver(value: NotificationChannelConfig) {
    return encrypt(JSON.stringify(value))
  },
})

export type DiscordChannelConfig = {
  webhookUrl: string
}

export type TelegramChannelConfig = {
  botToken: string
  chatId: string
}

// Middleman email channels carry their OWN SMTP (per-user, per D1) — PNF does
// not relay delegators' mail — so the transport credentials live inside the
// encrypted channel config rather than a shared singleton.
export type EmailSmtpConfig = {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  fromAddress: string
  fromName?: string
}

export type EmailChannelConfig = {
  to: string[]
  cc?: string[]
  bcc?: string[]
  smtp: EmailSmtpConfig
}

export type NotificationChannelConfig =
  | DiscordChannelConfig
  | TelegramChannelConfig
  | EmailChannelConfig

export const notificationChannelsTable = pgTable('notification_channels', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  type: notificationChannelTypeEnum().notNull(),
  config: encryptedJson('config').notNull(),
  notificationFlags: json('notificationFlags').$type<NotificationFlags>().notNull().default(DEFAULT_NOTIFICATION_FLAGS),
  enabled: boolean().notNull().default(true),
  createdAt: timestamp().defaultNow(),
  // Owner wallet — the per-user scoping key. A channel is only ever read or
  // mutated by the wallet that created it.
  createdBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
  updatedBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
})

export type NotificationChannel = typeof notificationChannelsTable.$inferSelect
export type InsertNotificationChannel = typeof notificationChannelsTable.$inferInsert

// Loosely typed per-event metadata; the concrete shape per event type is built
// and consumed in the middleman-workflows dispatch/message layer.
export type NotificationEventMetadata = Record<string, unknown>

export type NotificationEventChannel = {
  id: number
  name: string
  type: string
  status?: 'sent' | 'error'
  error?: string
}

export const notificationEventsTable = pgTable('notification_events', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  uuid: uuid('uuid').notNull().unique().defaultRandom(),
  type: notificationEventTypeEnum().notNull(),
  // Owner wallet — events are per-user, scoped to the affected record's owner.
  createdBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
  metadata: json('metadata').$type<NotificationEventMetadata>(),
  channels: json('channels').$type<NotificationEventChannel[]>().notNull().default([]),
  createdAt: timestamp().defaultNow().notNull(),
  viewedAt: timestamp(),
})

export type NotificationEvent = typeof notificationEventsTable.$inferSelect
export type InsertNotificationEvent = typeof notificationEventsTable.$inferInsert

// Per-wallet notification preferences. Absent row = defaults (feed enabled).
export const notificationPreferencesTable = pgTable('notification_preferences', {
  userIdentity: varchar({ length: 255 })
    .primaryKey()
    .references(() => usersTable.identity),
  inAppFeedEnabled: boolean().notNull().default(true),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
})

export type NotificationPreferences = typeof notificationPreferencesTable.$inferSelect
export type InsertNotificationPreferences = typeof notificationPreferencesTable.$inferInsert

export { NotificationChannelType }