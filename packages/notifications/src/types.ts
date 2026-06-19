export interface DiscordEmbed {
  title?: string
  url?: string
  description?: string
  color?: number
  timestamp?: string
  footer?: { text: string; icon_url?: string }
  fields?: Array<{ name: string; value: string; inline?: boolean }>
}

export interface NotificationMessage {
  title: string
  body: string
  discord?: { embeds: DiscordEmbed[] }
  telegram?: { html: string }
  email?: { subject?: string; html: string }
}

export interface NotificationChannel {
  name: string
  send(message: NotificationMessage): Promise<void>
}

export interface DiscordConfig {
  webhookUrl: string
}

export interface TelegramConfig {
  botToken: string
  chatId: string
}

export interface EmailSmtpConfig {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  fromAddress: string
  fromName?: string
}

export interface EmailConfig {
  to: string[]
  cc?: string[]
  bcc?: string[]
  smtp: EmailSmtpConfig
}
