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
