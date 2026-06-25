'use server'

import { z } from 'zod'
import {
  getSmtpConfig,
  upsertSmtpConfig,
  deleteSmtpConfig,
} from '@/lib/dal/notificationChannels'
import { withRequireOwner } from '@/lib/utils/actionUtils'
import { EmailChannel } from '@igniter/notifications'

// Password is optional: an empty value on update means "keep the stored
// password". The DAL omits the column from the UPDATE and rejects an INSERT
// without one.
const SmtpConfigSchema = z.object({
  host: z.string().min(1, 'Host is required').trim(),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(true),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  fromAddress: z.string().email('Please enter a valid email address'),
  fromName: z.string().max(255).optional(),
})

export async function GetSmtpConfiguration() {
  return withRequireOwner(async () => {
    const config = await getSmtpConfig()
    if (!config) return null
    // Never send the stored password to the client
    return { ...config, password: '' }
  })
}

export async function UpsertSmtpConfiguration(
  data: z.infer<typeof SmtpConfigSchema>,
) {
  return withRequireOwner(async (user) => {
    const validated = SmtpConfigSchema.parse(data)
    return upsertSmtpConfig({
      ...validated,
      password: validated.password || undefined,
      fromName: validated.fromName ?? null,
      createdBy: user.identity,
      updatedBy: user.identity,
    })
  })
}

export async function DeleteSmtpConfiguration() {
  return withRequireOwner(async () => deleteSmtpConfig())
}

export async function TestSmtpConfiguration(to: string, formData: z.infer<typeof SmtpConfigSchema>) {
  return withRequireOwner(async () => {
    const toSchema = z.string().email('Please enter a valid email address')
    toSchema.parse(to)

    const validated = SmtpConfigSchema.parse(formData)

    // Empty password in the form means "use the stored one"
    let password = validated.password
    if (!password) {
      const stored = await getSmtpConfig()
      if (!stored) throw new Error('Password is required')
      password = stored.password
    }

    const email = new EmailChannel({
      to: [to],
      smtp: {
        host: validated.host,
        port: validated.port,
        secure: validated.secure,
        username: validated.username,
        password,
        fromAddress: validated.fromAddress,
        fromName: validated.fromName,
      },
    })

    await email.send({
      title: 'SMTP test',
      body: 'This is a test email from your provider. If you received this, your SMTP configuration is correct.',
    })
  })
}
