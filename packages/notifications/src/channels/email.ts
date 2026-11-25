import { getLogger } from '@igniter/logger'
import net from 'node:net'
import nodemailer, { type Transporter } from 'nodemailer'
import type { EmailConfig, EmailSmtpConfig, NotificationChannel, NotificationMessage } from '../types'
import { assertSafeHost, isAllowlistedHost, isOperatorTrustedHost, resolveSafeAddress } from '../egressGuard'
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

/** SMTP submission/relay ports a user-configured server may use. */
export const ALLOWED_SMTP_PORTS: ReadonlySet<number> = new Set([25, 465, 587, 2525])

const SMTP_CONNECT_TIMEOUT_MS = 30_000

type GetSocketCallback = (err: Error | null, socketOptions?: { connection: net.Socket } | false) => void

/**
 * nodemailer `getSocket` hook that pins every SMTP connection (pooled or not) to an
 * address vetted by the egress guard at connect time. Without it nodemailer resolves
 * the hostname itself AFTER our check, so a rebinding DNS answer could steer the
 * socket at an internal service. The hostname stays in the transport options, so
 * SNI and certificate verification (implicit TLS and STARTTLS) still use it.
 * Ports are restricted to ALLOWED_SMTP_PORTS unless the operator trusts the host:
 * an allowlisted literal, or every resolved address inside an allowlisted CIDR
 * (e.g. localnet mailpit:1025 resolving into 10.0.0.0/8).
 */
export function pinnedSmtpGetSocket(smtp: Pick<EmailSmtpConfig, 'host' | 'port'>) {
  return (_options: unknown, callback: GetSocketCallback): void => {
    const portAllowed = ALLOWED_SMTP_PORTS.has(smtp.port) || isAllowlistedHost(smtp.host)
      ? Promise.resolve(true)
      // An operator-trusted internal host (every address in an allowlisted CIDR, e.g.
      // localnet mailpit:1025 in 10.0.0.0/8) may use another port.
      : isOperatorTrustedHost(smtp.host)
    portAllowed.then((ok) => {
      if (!ok) throw new Error(`SMTP port ${smtp.port} is not allowed`)
      return resolveSafeAddress(smtp.host)
    }).then(
      (ip) => {
        const socket = net.connect({ host: ip, port: smtp.port })
        let done = false
        const finish = (err: Error | null) => {
          if (done) return
          done = true
          socket.setTimeout(0)
          socket.removeListener('error', onError)
          if (err) {
            socket.destroy()
            callback(err)
          } else {
            callback(null, { connection: socket })
          }
        }
        const onError = (e: Error) => finish(e)
        socket.once('error', onError)
        socket.setTimeout(SMTP_CONNECT_TIMEOUT_MS, () => finish(new Error('SMTP connection timeout')))
        socket.once('connect', () => finish(null))
      },
      (err: Error) => callback(err),
    )
  }
}

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
    // Connect to the guard-vetted IP, never to a second DNS answer.
    getSocket: pinnedSmtpGetSocket(smtp),
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