import { z } from 'zod'

// Shared zod schemas for notification-channel configs. Both apps validate the
// same Discord/Telegram/Email shapes; the only app-specific bit is whether an
// email channel carries its own SMTP (per-user middleman) or relies on a shared
// instance SMTP (single-owner provider) — compose EmailRecipientsSchema with
// EmailSmtpConfigSchema accordingly.

export const DiscordConfigSchema = z.object({
  webhookUrl: z.string().url('Please enter a valid webhook URL'),
})

export const TelegramConfigSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
})

export const EmailRecipientsSchema = z.object({
  to: z
    .array(z.string().email('Invalid email address'))
    .min(1, 'At least one recipient is required'),
  cc: z.array(z.string().email('Invalid email address')).optional(),
  bcc: z.array(z.string().email('Invalid email address')).optional(),
})

export const EmailSmtpConfigSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().positive(),
  secure: z.boolean(),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  fromAddress: z.string().email('Invalid from address'),
  fromName: z.string().optional(),
})

// Transport-level email config: recipients plus their own SMTP. Matches the
// EmailConfig shape consumed by EmailChannel in ./types.
export const EmailConfigSchema = EmailRecipientsSchema.extend({
  smtp: EmailSmtpConfigSchema,
})

export type DiscordConfigInput = z.infer<typeof DiscordConfigSchema>
export type TelegramConfigInput = z.infer<typeof TelegramConfigSchema>
export type EmailRecipientsInput = z.infer<typeof EmailRecipientsSchema>
export type EmailSmtpConfigInput = z.infer<typeof EmailSmtpConfigSchema>
export type EmailConfigInput = z.infer<typeof EmailConfigSchema>