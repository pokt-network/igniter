import { getLogger } from '@igniter/logger'
import nodemailer, { type Transporter } from 'nodemailer'
import type { EmailConfig, EmailSmtpConfig, NotificationChannel, NotificationMessage } from '../types'
import { assertSafeHost } from '../egressGuard'
import { ChannelDeliveryError, type ChannelErrorCategory } from '../channelError'

// Map a nodemailer/SMTP failure to a coarse category. nodemailer surfaces an SMTP
// reply code on `responseCode` and a transport error class on `code`.
function categorizeSmtpError(err: unknown): ChannelErrorCategory {
  const e = err as { code?: string; responseCode?: number }
  if (e?.code === 'EAUTH' || e?.responseCode === 535) return 'auth'
  if (e?.code && ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'EDNS', 'EHOSTUNREACH'].includes(e.code))
    return 'transient'
  const rc = e?.responseCode
  if (typeof rc === 'number') {
    if (rc === 550 || rc === 553 || rc === 501) return 'invalid_request' // bad mailbox/recipient
    if (rc >= 500) return 'invalid_request'
    if (rc >= 400) return 'transient' // 4xx = temporary per SMTP
  }
  return 'transient'
}

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

    // SSRF guard: refuse connecting to internal/private SMTP hosts.
    await assertSafeHost(smtp.host)

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

      logger.debug('Email notification sent', { messageId: info.messageId, to })
    } catch (err) {
      // Log the raw error server-side (it leaks host:port reachability); surface
      // only a category so the caller can tell an auth/recipient problem from a
      // transient one without seeing the underlying transport detail.
      logger.error('Email notification failed', { err })
      throw new ChannelDeliveryError('email', categorizeSmtpError(err))
    } finally {
      if (ownsTransporter) transporter.close()
    }
  }
}