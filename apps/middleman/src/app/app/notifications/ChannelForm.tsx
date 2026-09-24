'use client'

import React, { useEffect, useState } from 'react'
import { Button } from '@igniter/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@igniter/ui/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@igniter/ui/components/select'
import { Input } from '@igniter/ui/components/input'
import { Switch } from '@igniter/ui/components/switch'
import { Label } from '@igniter/ui/components/label'
import { LoaderIcon } from '@igniter/ui/assets'
import { toast } from "@igniter/ui/components/sonner";
import { NotificationChannelType } from '@igniter/db/middleman/enums'
import type { NotificationEventType, NotificationFlags } from '@igniter/db/middleman/schema'
import { DEFAULT_NOTIFICATION_FLAGS } from '@igniter/db/middleman/schema'
import type { NotificationChannelListItem } from '@/lib/dal/notificationChannels'
import {
  CreateNotificationChannel,
  GetNotificationChannel,
  UpdateNotificationChannel,
  TestNotificationChannelConfig,
} from '@/actions/NotificationChannels'

const EVENT_LABELS: Array<{ type: NotificationEventType; label: string; description: string }> = [
  { type: 'service_change', label: 'Service changed', description: 'A service is added or removed on one of your suppliers.' },
  { type: 'revshare_change', label: 'Revenue share changed', description: "A supplier's revenue share changes on-chain." },
  { type: 'stake', label: 'Stake outcome', description: 'A stake transaction succeeds or fails.' },
  { type: 'unstake', label: 'Unstake outcome', description: 'An unstake transaction succeeds or fails.' },
  { type: 'upstake', label: 'Upstake outcome', description: 'An upstake transaction succeeds or fails.' },
  { type: 'operational_funds', label: 'Operational funds', description: 'An operational funding transaction settles.' },
  { type: 'import_result', label: 'Import result', description: 'A supplier import completes or fails.' },
]

// Port 587 is STARTTLS (secure: false); implicit-TLS is port 465 (secure: true).
// Default to the 587/STARTTLS pairing so the test doesn't hang on a TLS mismatch.
const SMTP_BLANK = { host: '', port: 587, secure: false, username: '', password: '', fromAddress: '', fromName: '' }

interface ChannelFormProps {
  channel?: NotificationChannelListItem
  onClose: (changed: boolean) => void
}

function splitEmails(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

const CHANNEL_TYPE_LABELS: Record<NotificationChannelType, string> = {
  [NotificationChannelType.Discord]: 'Discord',
  [NotificationChannelType.Telegram]: 'Telegram',
  [NotificationChannelType.Email]: 'Email',
}

export function ChannelForm({ channel, onClose }: ChannelFormProps) {
  const isEdit = !!channel
  const [name, setName] = useState(channel?.name ?? '')
  const [type, setType] = useState<NotificationChannelType>(
    (channel?.type as NotificationChannelType) ?? NotificationChannelType.Discord,
  )
  const [enabled, setEnabled] = useState(channel?.enabled ?? true)
  const [flags, setFlags] = useState<NotificationFlags>(channel?.notificationFlags ?? { ...DEFAULT_NOTIFICATION_FLAGS })

  // Discord
  const [webhookUrl, setWebhookUrl] = useState('')
  // Telegram
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  // Email
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  // port widened to allow '' so clearing the field shows empty instead of 0
  // (Number('') === 0). buildConfig coerces back to a number on submit.
  const [smtp, setSmtp] = useState<Omit<typeof SMTP_BLANK, 'port'> & { port: number | '' }>({ ...SMTP_BLANK })

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  // Two-step add/edit: configure → verify. The channel cannot be saved until a
  // test message has been sent successfully (matching the provider flow).
  const [step, setStep] = useState<'configure' | 'verify'>('configure')
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  // Reported inside the dialog rather than in the bell or a toast: the dialog
  // stays open on failure, and its overlay covers the top bar — a message
  // anywhere else would be unreachable until the user gave up and closed it.
  const [formError, setFormError] = useState('')

  // On edit, load the stored (non-secret) config to prefill. Secret fields
  // (webhook URL, bot token, SMTP password) come back blank — they are
  // write-only and a blank value means "keep the stored secret".
  useEffect(() => {
    if (!channel) return
    let cancelled = false
    ;(async () => {
      const res = await GetNotificationChannel(channel.id)
      if (cancelled) return
      if (res.success && res.data) {
        const cfg = res.data.config as Record<string, unknown>
        if (channel.type === NotificationChannelType.Telegram) {
          setChatId(String(cfg.chatId ?? ''))
        } else if (channel.type === NotificationChannelType.Email) {
          setTo(((cfg.to as string[]) ?? []).join(', '))
          setCc(((cfg.cc as string[]) ?? []).join(', '))
          setBcc(((cfg.bcc as string[]) ?? []).join(', '))
          const s = (cfg.smtp as typeof SMTP_BLANK) ?? SMTP_BLANK
          setSmtp({ ...s, password: '', fromName: s.fromName ?? '' })
        }
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [channel])

  function buildConfig(): unknown {
    if (type === NotificationChannelType.Discord) return { webhookUrl }
    if (type === NotificationChannelType.Telegram) return { botToken, chatId }
    return {
      to: splitEmails(to),
      ...(cc.trim() && { cc: splitEmails(cc) }),
      ...(bcc.trim() && { bcc: splitEmails(bcc) }),
      smtp: { ...smtp, port: Number(smtp.port), fromName: smtp.fromName || undefined },
    }
  }

  async function runTest() {
    setTestState('sending')
    setTestError('')
    try {
      const res = await TestNotificationChannelConfig({ type, config: buildConfig(), channelId: channel?.id })
      if (!res.success) throw new Error(res.error.message)
      setTestState('sent')
    } catch (e) {
      setTestState('error')
      setTestError(e instanceof Error ? e.message : 'Test failed.')
    }
  }

  function handleNext() {
    if (!name.trim()) {
      setFormError('Please enter a name.')
      return
    }
    setFormError('')
    setStep('verify')
    void runTest()
  }

  async function handleSave() {
    setSaving(true)
    setFormError('')
    try {
      const config = buildConfig()
      const res = isEdit
        ? await UpdateNotificationChannel(channel!.id, { name, enabled, config, notificationFlags: flags })
        : await CreateNotificationChannel({ name, type, enabled, config, notificationFlags: flags })
      if (!res.success) throw new Error(res.error.message)
      toast.success(isEdit ? 'Channel updated.' : 'Channel created.', { id: 'channel-saved' })
      onClose(true)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save channel.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={() => onClose(false)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogTitle>{isEdit ? 'Edit channel' : 'Add channel'}</DialogTitle>

        {loading ? (
          <div className="flex justify-center py-8">
            <LoaderIcon className="h-5 w-5 animate-spin" />
          </div>
        ) : step === 'configure' ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`My ${CHANNEL_TYPE_LABELS[type]} channel`} />
            </div>

            <div className="flex flex-col gap-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as NotificationChannelType)} disabled={isEdit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NotificationChannelType.Discord}>Discord</SelectItem>
                  <SelectItem value={NotificationChannelType.Telegram}>Telegram</SelectItem>
                  <SelectItem value={NotificationChannelType.Email}>Email</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label>Enabled</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Events</Label>
              {EVENT_LABELS.map((ev) => (
                <div key={ev.type} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm">{ev.label}</p>
                    <p className="text-xs text-text-secondary">{ev.description}</p>
                  </div>
                  <Switch
                    checked={flags[ev.type] ?? true}
                    onCheckedChange={(v) => setFlags((f) => ({ ...f, [ev.type]: v }))}
                  />
                </div>
              ))}
            </div>

            {type === NotificationChannelType.Discord && (
              <div className="flex flex-col gap-1">
                <Label>Webhook URL</Label>
                <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder={isEdit ? '•••••• (leave blank to keep)' : 'https://discord.com/api/webhooks/...'} />
              </div>
            )}

            {type === NotificationChannelType.Telegram && (
              <>
                <div className="flex flex-col gap-1">
                  <Label>Bot token</Label>
                  <Input value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={isEdit ? '•••••• (leave blank to keep)' : '123456:ABC-DEF...'} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Chat ID</Label>
                  <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" />
                </div>
              </>
            )}

            {type === NotificationChannelType.Email && (
              <>
                <div className="flex flex-col gap-1">
                  <Label>To (comma-separated)</Label>
                  <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="me@example.com, ops@example.com" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Cc (optional)</Label>
                  <Input value={cc} onChange={(e) => setCc(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Bcc (optional)</Label>
                  <Input value={bcc} onChange={(e) => setBcc(e.target.value)} />
                </div>
                <p className="mt-2 text-xs text-text-secondary">
                  SMTP server — your own mail relay (you own its uptime, not Igniter).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label>Host</Label>
                    <Input value={smtp.host} onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))} placeholder="smtp.example.com" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Port</Label>
                    <Input type="number" value={smtp.port} onChange={(e) => setSmtp((s) => ({ ...s, port: e.target.value === '' ? '' : Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Use TLS/SSL</Label>
                  <Switch checked={smtp.secure} onCheckedChange={(v) => setSmtp((s) => ({ ...s, secure: v }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label>Username</Label>
                    <Input value={smtp.username} onChange={(e) => setSmtp((s) => ({ ...s, username: e.target.value }))} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Password</Label>
                    <Input type="password" value={smtp.password} onChange={(e) => setSmtp((s) => ({ ...s, password: e.target.value }))} placeholder={isEdit ? '•••••• (leave blank to keep)' : ''} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label>From address</Label>
                    <Input value={smtp.fromAddress} onChange={(e) => setSmtp((s) => ({ ...s, fromAddress: e.target.value }))} placeholder="notifications@example.com" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>From name (optional)</Label>
                    <Input value={smtp.fromName} onChange={(e) => setSmtp((s) => ({ ...s, fromName: e.target.value }))} />
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <p className="text-sm">
              We sent a test message to <strong>{name || 'this channel'}</strong>. Confirm you
              received it before saving.
            </p>
            {testState === 'sending' && (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <LoaderIcon className="h-4 w-4 animate-spin" /> Sending test…
              </div>
            )}
            {testState === 'sent' && (
              <p className="text-sm text-green-500">Test message sent. Did you receive it?</p>
            )}
            {testState === 'error' && (
              <p className="text-sm text-red-500">Test failed: {testError}</p>
            )}
          </div>
        )}

        {formError && <p className="text-sm text-red-500">{formError}</p>}

        <DialogFooter>
          {step === 'configure' ? (
            <>
              <Button variant="outline" onClick={() => onClose(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleNext} disabled={loading || !name.trim()}>
                Next
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  // Drop a previous failure — it refers to what was submitted,
                  // not to what the user is about to edit.
                  setFormError('')
                  setStep('configure')
                }}
                disabled={saving}
              >
                Back
              </Button>
              <Button variant="secondary" onClick={() => void runTest()} disabled={saving || testState === 'sending'}>
                {testState === 'sending' && <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />}
                Resend
              </Button>
              <Button onClick={handleSave} disabled={saving || testState !== 'sent'}>
                {saving && <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? 'Save' : 'Create'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
