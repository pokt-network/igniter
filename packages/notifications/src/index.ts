export { Notifier } from './notifier'
export { DiscordChannel } from './channels/discord'
export { TelegramChannel } from './channels/telegram'
export { EmailChannel, createSmtpTransport } from './channels/email'
export type { Transporter } from 'nodemailer'
export type {
  NotificationChannel,
  NotificationMessage,
  DiscordEmbed,
  DiscordConfig,
  TelegramConfig,
  EmailConfig,
  EmailSmtpConfig,
} from './types'
export { assertSafeUrl, assertSafeHost } from './egressGuard'
export { composeRichMessage } from './richMessage'
export type { RichMessageParts } from './richMessage'
export { dispatchToChannels } from './dispatch'
export type {
  DispatchChannel,
  DispatchChannelType,
  ChannelDeliveryResult,
} from './dispatch'
export {
  DiscordConfigSchema,
  TelegramConfigSchema,
  EmailRecipientsSchema,
  EmailSmtpConfigSchema,
  EmailConfigSchema,
} from './validation'
export type {
  DiscordConfigInput,
  TelegramConfigInput,
  EmailRecipientsInput,
  EmailSmtpConfigInput,
  EmailConfigInput,
} from './validation'
