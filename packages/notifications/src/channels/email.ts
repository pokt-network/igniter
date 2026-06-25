import { getLogger } from '@igniter/logger'
import nodemailer, { type Transporter } from 'nodemailer'
import type { EmailConfig, EmailSmtpConfig, NotificationChannel, NotificationMessage } from '../types'

const logger = getLogger()

// Builds a nodemailer transport from SMTP config. Pass { pool: true } when the
// transport is reused across multiple sends (e.g. one activity run delivering
// to many email channels) so a single TCP+TLS+AUTH handshake is shared instead
// of one per message. The caller owns the lifecycle and must call
// `transporter.close()` when done.
export function createSmtpTransport(
  smtp: EmailSmtpConfig,
  opts: { pool?: boolean } = {},
): Transporter {
  const base = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.username,
      pass: smtp.password,
    },
  }
  // `pool: true` selects nodemailer's pooled-transport overload; the plain
  // options object selects the single-connection one.
  return opts.pool
    ? nodemailer.createTransport({ ...base, pool: true })
    : nodemailer.createTransport(base)
}

export class EmailChannel implements NotificationChannel {
  name = 'email'
  private config: EmailConfig
  private transporter?: Transporter

  constructor(config: EmailConfig, transporter?: Transporter) {
    this.config = config
    this.transporter = transporter
  }

  async send(message: NotificationMessage): Promise<void> {
    const { to, cc, bcc, smtp } = this.config

    const transporter = this.transporter ?? createSmtpTransport(smtp)
    const ownsTransporter = !this.transporter

    const from = smtp.fromName
      ? { name: smtp.fromName, address: smtp.fromAddress }
      : smtp.fromAddress

    try {
      const info = await transporter.sendMail({
        from,
        to,
        cc,
        bcc,
        subject: message.email?.subject ?? message.title,
        html: message.email?.html ?? message.body,
      })

      logger.debug({ messageId: info.messageId, to }, 'Email notification sent')
    } finally {
      if (ownsTransporter) transporter.close()
    }
  }
}