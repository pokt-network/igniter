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
import { usersTable } from './user'
import {
  notificationChannelTypeEnum,
  notificationEventTypeEnum,
  NOTIFICATION_EVENT_TYPES,
  NotificationChannelType,
} from './enums'

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export type NotificationFlags = Record<NotificationEventType, boolean>

export const DEFAULT_NOTIFICATION_FLAGS: NotificationFlags = {
  keys_staked: true,
  keys_unstaked: true,
  supplier_funds_low: true,
  supplier_stake_low: true,
  remediation_summary: true,
  delegators_synced: true,
}

const algorithm = 'aes-256-cbc'

function encrypt(text: string): string {
  const iv = Buffer.from(process.env.ENCRYPTION_IV!, 'hex')
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return iv.toString('hex') + ':' + encrypted
}

function decrypt(text: string): string {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
  const textParts = text.split(':')
  const iv = Buffer.from(textParts.shift()!, 'hex')
  const encryptedText = Buffer.from(textParts.join(':'), 'hex')
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  let decrypted = decipher.update(encryptedText, undefined, 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

const encryptedText = customType<{ data: string }>({
  dataType() {
    return 'text'
  },
  fromDriver(value: unknown) {
    return decrypt(value as string)
  },
  toDriver(value: string) {
    return encrypt(value)
  },
})

const encryptedJson = customType<{ data: NotificationChannelConfig }>({
  dataType() {
    return 'text'
  },
  fromDriver(value: unknown) {
    const raw = value as string
    try {
      return JSON.parse(decrypt(raw))
    } catch {
      return JSON.parse(raw)
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

export type EmailChannelConfig = {
  to: string[]
  cc?: string[]
  bcc?: string[]
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
  createdBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
  updatedBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
})

export type NotificationChannel = typeof notificationChannelsTable.$inferSelect
export type InsertNotificationChannel = typeof notificationChannelsTable.$inferInsert

export const smtpConfigurationTable = pgTable('smtp_configuration', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  host: varchar({ length: 255 }).notNull(),
  port: integer().notNull().default(587),
  secure: boolean().notNull().default(true),
  username: varchar({ length: 255 }).notNull(),
  password: encryptedText('password').notNull(),
  fromAddress: varchar({ length: 255 }).notNull(),
  fromName: varchar({ length: 255 }),
  createdAt: timestamp().defaultNow(),
  createdBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
  updatedAt: timestamp().defaultNow().$onUpdateFn(() => new Date()),
  updatedBy: varchar({ length: 255 }).references(() => usersTable.identity).notNull(),
})

export type SmtpConfiguration = typeof smtpConfigurationTable.$inferSelect
export type InsertSmtpConfiguration = typeof smtpConfigurationTable.$inferInsert

export type NotificationEventMetadata =
  | { addresses: string[]; height: number }
  | { byReason: Record<string, { succeeded: string[]; failed: string[] }>; height: number }
  | { inserted: number; updated: number; disabled: number }

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
  metadata: json('metadata').$type<NotificationEventMetadata>(),
  channels: json('channels').$type<NotificationEventChannel[]>().notNull().default([]),
  createdAt: timestamp().defaultNow().notNull(),
  viewedAt: timestamp(),
})

export type NotificationEvent = typeof notificationEventsTable.$inferSelect
export type InsertNotificationEvent = typeof notificationEventsTable.$inferInsert

export { NotificationChannelType }
