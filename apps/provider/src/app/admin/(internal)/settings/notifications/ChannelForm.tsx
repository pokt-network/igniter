'use client'

import React, { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@igniter/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@igniter/ui/components/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@igniter/ui/components/form'
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
import { PlusIcon, Trash2Icon, EyeIcon, KeyRoundIcon, UnlockIcon, WalletIcon, TrendingDownIcon, WrenchIcon, UsersIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@igniter/ui/components/popover'
import { NotificationChannelType } from '@igniter/db/provider/enums'
import type { NotificationEventType, NotificationFlags } from '@igniter/db/provider/schema'
import { DEFAULT_NOTIFICATION_FLAGS } from '@igniter/db/provider/schema'
import type { NotificationChannelListItem } from '@/lib/dal/notificationChannels'
import {
  CreateNotificationChannel,
  GetNotificationChannel,
  UpdateNotificationChannel,
  TestNotificationChannelConfig,
} from '@/actions/NotificationChannels'
import { GetSmtpConfiguration } from '@/actions/SmtpConfiguration'

interface EventTypeConfig {
  type: NotificationEventType
  icon: React.ReactNode
  label: string
  description: string
  exampleSummary: { title: string; body: string }
  exampleDetail?: { title: string; body: string }
}

const EXAMPLE_ADDRESS = 'pokt1abc...xyz9'
const EXAMPLE_BLOCK = '12345'

const EVENT_CONFIGS: EventTypeConfig[] = [
  {
    type: 'keys_staked',
    icon: <KeyRoundIcon className="h-4 w-4 text-green-500" />,
    label: 'Suppliers Staked',
    description: 'Sent when one or more suppliers transition to the Staked state.',
    exampleSummary: { title: '3 suppliers staked', body: '3 suppliers transitioned to Staked at block 12345.' },
    exampleDetail: { title: 'Supplier staked', body: `Supplier ${EXAMPLE_ADDRESS} is now staked (block ${EXAMPLE_BLOCK}).` },
  },
  {
    type: 'keys_unstaked',
    icon: <UnlockIcon className="h-4 w-4 text-yellow-500" />,
    label: 'Suppliers Unstaked',
    description: 'Sent when one or more suppliers begin the unstaking process.',
    exampleSummary: { title: '2 suppliers unstaked', body: `2 suppliers began unstaking at block ${EXAMPLE_BLOCK}.` },
    exampleDetail: { title: 'Supplier unstaking', body: `Supplier ${EXAMPLE_ADDRESS} began unstaking at block ${EXAMPLE_BLOCK}.` },
  },
  {
    type: 'supplier_funds_low',
    icon: <WalletIcon className="h-4 w-4 text-orange-500" />,
    label: 'Supplier Funds Low',
    description: "Sent when a supplier's operational funds fall below the minimum threshold.",
    exampleSummary: { title: '1 supplier with low funds', body: `1 supplier has operational funds below the minimum threshold.` },
    exampleDetail: { title: 'Supplier funds low', body: `Supplier ${EXAMPLE_ADDRESS} has operational funds below the minimum threshold.` },
  },
  {
    type: 'supplier_stake_low',
    icon: <TrendingDownIcon className="h-4 w-4 text-red-500" />,
    label: 'Supplier Stake Low',
    description: "Sent when a supplier's stake falls below the configured minimum.",
    exampleSummary: { title: '1 supplier with low stake', body: `1 supplier has stake below the minimum threshold.` },
    exampleDetail: { title: 'Supplier stake low', body: `Supplier ${EXAMPLE_ADDRESS} has stake below the minimum threshold.` },
  },
  {
    type: 'remediation_summary',
    icon: <WrenchIcon className="h-4 w-4 text-blue-500" />,
    label: 'Remediation Summary',
    description: 'Sent after each remediation workflow run with a summary of results.',
    exampleSummary: { title: 'Remediation complete: 4 succeeded, 1 failed', body: `Remediation run at block ${EXAMPLE_BLOCK} processed 5 suppliers.` },
  },
  {
    type: 'delegators_synced',
    icon: <UsersIcon className="h-4 w-4 text-purple-500" />,
    label: 'Delegators Synced',
    description: 'Sent when the governance delegator sync completes with changes.',
    exampleSummary: { title: 'Delegator sync complete', body: 'Governance sync completed with changes.' },
  },
]

function ExamplePreview({ config }: { config: EventTypeConfig }) {
  return (
    <div className="flex flex-col gap-3 min-w-[240px] max-w-[280px]">
      <div className="text-xs font-medium text-text-secondary uppercase tracking-wide">Example</div>
      <div className="rounded border border-border-primary bg-bg-secondary p-2.5 flex flex-col gap-1">
        <div className="text-xs font-semibold text-text-primary">{config.exampleSummary.title}</div>
        <div className="text-[11px] text-text-secondary whitespace-pre-wrap leading-relaxed">{config.exampleSummary.body}</div>
      </div>
    </div>
  )
}

// Secrets (webhook URL, bot token) are write-only: when editing, the field
// arrives blank to mean "keep the stored value", so blank must validate. On
// create the real value is still required.
const makeDiscordConfigSchema = (isEdit: boolean) =>
  z.object({
    webhookUrl: isEdit
      ? z.union([z.literal(''), z.string().url('Please enter a valid webhook URL')])
      : z.string().url('Please enter a valid webhook URL'),
  })

const makeTelegramConfigSchema = (isEdit: boolean) =>
  z.object({
    botToken: isEdit ? z.string() : z.string().min(1, 'Bot token is required'),
    chatId: z.string().min(1, 'Chat ID is required'),
  })

const EmailConfigSchema = z.object({
  to: z
    .array(z.object({ value: z.string().email('Invalid email address') }))
    .min(1, 'At least one recipient is required'),
  cc: z.array(z.object({ value: z.string().email('Invalid email address') })).optional(),
  bcc: z.array(z.object({ value: z.string().email('Invalid email address') })).optional(),
})

const ChannelFormBaseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.nativeEnum(NotificationChannelType),
  enabled: z.boolean().default(true),
  notificationFlags: z.record(z.boolean()).default(DEFAULT_NOTIFICATION_FLAGS),
  // Sub-schemas are loose at the base level — superRefine enforces strict
  // validation only for the currently selected type so that unfilled fields
  // for the other types don't make the form permanently invalid.
  discord: z.object({ webhookUrl: z.string() }).optional(),
  telegram: z.object({ botToken: z.string(), chatId: z.string() }).optional(),
  email: z.object({
    to: z.array(z.object({ value: z.string() })).optional(),
    cc: z.array(z.object({ value: z.string() })).optional(),
    bcc: z.array(z.object({ value: z.string() })).optional(),
  }).optional(),
})

const makeChannelFormSchema = (isEdit: boolean) =>
  ChannelFormBaseSchema.superRefine((data, ctx) => {
    if (data.type === NotificationChannelType.Discord) {
      const result = makeDiscordConfigSchema(isEdit).safeParse(data.discord)
      if (!result.success) {
        result.error.issues.forEach((issue) =>
          ctx.addIssue({ ...issue, path: ['discord', ...issue.path] })
        )
      }
    }
    if (data.type === NotificationChannelType.Telegram) {
      const result = makeTelegramConfigSchema(isEdit).safeParse(data.telegram)
      if (!result.success) {
        result.error.issues.forEach((issue) =>
          ctx.addIssue({ ...issue, path: ['telegram', ...issue.path] })
        )
      }
    }
    if (data.type === NotificationChannelType.Email) {
      const result = EmailConfigSchema.safeParse(data.email)
      if (!result.success) {
        result.error.issues.forEach((issue) =>
          ctx.addIssue({ ...issue, path: ['email', ...issue.path] })
        )
      }
    }
  })

type ChannelFormValues = z.infer<typeof ChannelFormBaseSchema>

interface DiscordChannelConfig { webhookUrl: string }
interface TelegramChannelConfig { botToken: string; chatId: string }
interface EmailChannelConfig { to: string[]; cc?: string[]; bcc?: string[] }

function toFieldArray(arr?: string[]): { value: string }[] {
  return (arr ?? []).map((v) => ({ value: v }))
}

function fromFieldArray(arr?: { value: string }[]): string[] {
  return (arr ?? []).map((v) => v.value).filter(Boolean)
}

export interface ChannelFormProps {
  channel?: NotificationChannelListItem
  onClose: (changed: boolean) => void
}

type Step = 'configure' | 'verify'

export function ChannelForm({ channel, onClose }: ChannelFormProps) {
  const isEdit = !!channel
  const channelFormSchema = React.useMemo(() => makeChannelFormSchema(isEdit), [isEdit])
  const [step, setStep] = useState<Step>('configure')
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<'idle' | 'sent' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)

  const form = useForm<ChannelFormValues>({
    resolver: zodResolver(channelFormSchema),
    defaultValues: {
      name: channel?.name ?? '',
      type: channel?.type ?? NotificationChannelType.Discord,
      enabled: channel?.enabled ?? true,
      notificationFlags: channel?.notificationFlags
        ? { ...DEFAULT_NOTIFICATION_FLAGS, ...(channel.notificationFlags as Record<string, boolean>) }
        : { ...DEFAULT_NOTIFICATION_FLAGS },
      discord: { webhookUrl: '' },
      telegram: { botToken: '', chatId: '' },
      email: { to: [{ value: '' }], cc: [], bcc: [] },
    },
  })

  // The channel list no longer carries configs (they hold secrets), so the
  // edit form fetches the full channel on demand and prefills the fields.
  const { data: fullChannel, isLoading: isLoadingConfig } = useQuery({
    queryKey: ['notification-channel', channel?.id],
    queryFn: async () => {
      const result = await GetNotificationChannel(channel!.id)
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    enabled: isEdit,
  })

  useEffect(() => {
    if (!fullChannel) return
    const values = form.getValues()
    if (fullChannel.type === NotificationChannelType.Discord) {
      const config = fullChannel.config as DiscordChannelConfig
      form.reset({ ...values, discord: { webhookUrl: config.webhookUrl } })
    } else if (fullChannel.type === NotificationChannelType.Telegram) {
      const config = fullChannel.config as TelegramChannelConfig
      form.reset({ ...values, telegram: { botToken: config.botToken, chatId: config.chatId } })
    } else if (fullChannel.type === NotificationChannelType.Email) {
      const config = fullChannel.config as EmailChannelConfig
      form.reset({
        ...values,
        email: {
          to: toFieldArray(config.to),
          cc: toFieldArray(config.cc),
          bcc: toFieldArray(config.bcc),
        },
      })
    }
  }, [fullChannel])

  const selectedType = form.watch('type')
  const isEmailType = selectedType === NotificationChannelType.Email

  const { data: smtpConfig, isLoading: isLoadingSmtp } = useQuery({
    queryKey: ['smtp-config'],
    queryFn: async () => {
      const result = await GetSmtpConfiguration()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    enabled: isEmailType,
  })
  const smtpMissing = isEmailType && !isLoadingSmtp && !smtpConfig

  const toFields = useFieldArray({ control: form.control, name: 'email.to' })
  const ccFields = useFieldArray({ control: form.control, name: 'email.cc' })
  const bccFields = useFieldArray({ control: form.control, name: 'email.bcc' })

  // Run test when entering verify step using current form values (not the saved DB record)
  useEffect(() => {
    if (step === 'verify') {
      runTest()
    }
  }, [step])

  const runTest = async () => {
    const values = form.getValues()
    setIsTesting(true)
    setTestResult('idle')
    setTestError(null)
    try {
      const result = await TestNotificationChannelConfig({
        type: values.type,
        config: buildConfig(values),
        // On edit a blank secret means "use the stored one" — the action merges
        // it back from this channel before sending the test.
        channelId: channel?.id,
      })
      if (!result.success) throw new Error(result.error.message)
      setTestResult('sent')
    } catch (err) {
      setTestResult('error')
      setTestError(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setIsTesting(false)
    }
  }

  const buildConfig = (values: ChannelFormValues) => {
    if (values.type === NotificationChannelType.Discord) {
      return { webhookUrl: values.discord!.webhookUrl }
    }
    if (values.type === NotificationChannelType.Telegram) {
      return { botToken: values.telegram!.botToken, chatId: values.telegram!.chatId }
    }
    if (values.type === NotificationChannelType.Email) {
      return {
        to: fromFieldArray(values.email!.to),
        cc: fromFieldArray(values.email!.cc),
        bcc: fromFieldArray(values.email!.bcc),
      }
    }
    throw new Error('Unknown type')
  }

  const handleCancel = () => {
    if (!isEdit) {
      onClose(false)
      return
    }
    const formValues = form.getValues()
    const defaultValues = form.formState.defaultValues
    const dirty = JSON.stringify(formValues) !== JSON.stringify(defaultValues)
    if (dirty) {
      setIsCancelling(true)
    } else {
      onClose(false)
    }
  }

  const handleNext = async () => {
    const valid = await form.trigger()
    if (!valid) return
    setStep('verify')
  }

  const handleVerifyDone = async () => {
    const values = form.getValues()
    setSaveError(null)
    setIsSaving(true)
    try {
      const config = buildConfig(values)
      if (isEdit) {
        const result = await UpdateNotificationChannel(channel!.id, {
          name: values.name,
          enabled: values.enabled,
          config,
          notificationFlags: values.notificationFlags as NotificationFlags,
        })
        if (!result.success) throw new Error(result.error.message)
      } else {
        const result = await CreateNotificationChannel({
          name: values.name,
          type: values.type,
          enabled: values.enabled,
          config,
          notificationFlags: values.notificationFlags as NotificationFlags,
        })
        if (!result.success) throw new Error(result.error.message)
      }
      onClose(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save channel')
    } finally {
      setIsSaving(false)
    }
  }

  const handleVerifyBack = () => {
    setStep('configure')
    setTestResult('idle')
    setTestError(null)
  }

  const { isValid } = form.formState

  return (
    <Dialog open>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        className="gap-0 p-0 rounded-lg bg-bg-elevated !w-[520px] !min-w-none !max-w-none max-h-[90vh] overflow-y-auto"
        hideClose
      >
        <DialogTitle asChild>
          <div className="flex flex-row justify-between items-center py-4 px-4">
            <span className="text-[14px]">
              {isEdit ? `Edit Channel: ${channel.name}` : 'Add Notification Channel'}
            </span>
            {step === 'configure' && (
              <span className="text-xs text-text-tertiary">Step 1 of 2 — Configure</span>
            )}
            {step === 'verify' && (
              <span className="text-xs text-text-tertiary">Step 2 of 2 — Verify</span>
            )}
          </div>
        </DialogTitle>

        {saveError ? (
          <div className="flex flex-col items-center bg-bg-root">
            <div className="flex items-center p-2 text-sm text-red-400">{saveError}</div>
            <div className="!min-h-0.5 !h-[2px] w-full bg-linear-to-r from-[color:#f97834] to-[color:#f8a23e]" />
          </div>
        ) : (
          <div className="h-px bg-[var(--slate-dividers)]" />
        )}

        <div className="px-4 py-4">
          {step === 'configure' && (
            <Form {...form}>
              <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
                {/* Name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm">Name</FormLabel>
                      <FormControl>
                        <Input {...field} className="h-9 text-sm" placeholder="e.g., Discord Ops" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Type */}
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm">Type</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={isEdit}
                      >
                        <FormControl>
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NotificationChannelType.Discord}>Discord</SelectItem>
                          <SelectItem value={NotificationChannelType.Telegram}>Telegram</SelectItem>
                          <SelectItem value={NotificationChannelType.Email}>Email</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Enabled */}
                <FormField
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-3">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            id="channel-enabled"
                          />
                        </FormControl>
                        <Label htmlFor="channel-enabled" className="text-sm cursor-pointer">
                          Enabled
                        </Label>
                      </div>
                    </FormItem>
                  )}
                />

                <div className="h-px bg-border-primary" />

                {/* Notification flags */}
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Event Subscriptions</span>
                  <p className="text-[11px] text-text-tertiary">Choose which events this channel receives.</p>
                  <div className="flex flex-col divide-y divide-border-primary rounded border border-border-primary">
                    {EVENT_CONFIGS.map((config) => {
                      const flagValue = form.watch(`notificationFlags.${config.type}`) ?? true
                      return (
                        <div key={config.type} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="flex-shrink-0">{config.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-text-primary">{config.label}</div>
                            <div className="text-[11px] text-text-tertiary">{config.description}</div>
                          </div>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" title="Preview example message">
                                <EyeIcon className="h-3.5 w-3.5 text-text-tertiary" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-auto p-3">
                              <ExamplePreview config={config} />
                            </PopoverContent>
                          </Popover>
                          <Switch
                            checked={!!flagValue}
                            onCheckedChange={(v) => form.setValue(`notificationFlags.${config.type}`, v)}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="h-px bg-border-primary" />

                {/* Discord config */}
                {selectedType === NotificationChannelType.Discord && (
                  <FormField
                    control={form.control}
                    name="discord.webhookUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Webhook URL</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="h-9 text-sm"
                            placeholder={isEdit ? 'Leave blank to keep current webhook URL' : 'https://discord.com/api/webhooks/…'}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {/* Telegram config */}
                {selectedType === NotificationChannelType.Telegram && (
                  <div className="flex flex-col gap-4">
                    <FormField
                      control={form.control}
                      name="telegram.botToken"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Bot Token</FormLabel>
                          <FormControl>
                            <Input {...field} className="h-9 text-sm" placeholder={isEdit ? 'Leave blank to keep current token' : '1234567890:ABC…'} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="telegram.chatId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm">Chat ID</FormLabel>
                          <FormControl>
                            <Input {...field} className="h-9 text-sm" placeholder="-100123456789" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Email config */}
                {selectedType === NotificationChannelType.Email && (
                  <div className="flex flex-col gap-4">
                    {smtpMissing ? (
                      <div className="rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2.5 text-[11px] text-orange-300 leading-relaxed">
                        <p className="font-medium mb-0.5">SMTP not configured</p>
                        <p>Email channels require SMTP to be set up first. Go to the Notifications settings page and configure SMTP before adding an email channel.</p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-text-tertiary">
                        SMTP settings are configured globally in the SMTP section. Only specify recipient addresses here.
                      </p>
                    )}

                    {/* To */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">To</span>
                        <button
                          type="button"
                          className="text-xs flex items-center gap-1 hover:underline"
                          style={{ color: 'var(--pnf-blue-light, #5ba3f5)' }}
                          onClick={() => toFields.append({ value: '' })}
                        >
                          <PlusIcon className="h-3 w-3" /> Add
                        </button>
                      </div>
                      {toFields.fields.map((field, idx) => (
                        <div key={field.id} className="flex gap-2">
                          <FormField
                            control={form.control}
                            name={`email.to.${idx}.value`}
                            render={({ field: f }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input
                                    {...f}
                                    className="h-8 text-sm"
                                    placeholder="recipient@example.com"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {toFields.fields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() => toFields.remove(idx)}
                            >
                              <Trash2Icon className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* CC */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-secondary">CC</span>
                        <button
                          type="button"
                          className="text-xs flex items-center gap-1 hover:underline"
                          style={{ color: 'var(--pnf-blue-light, #5ba3f5)' }}
                          onClick={() => ccFields.append({ value: '' })}
                        >
                          <PlusIcon className="h-3 w-3" /> Add
                        </button>
                      </div>
                      {ccFields.fields.map((field, idx) => (
                        <div key={field.id} className="flex gap-2">
                          <FormField
                            control={form.control}
                            name={`email.cc.${idx}.value`}
                            render={({ field: f }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input {...f} className="h-8 text-sm" placeholder="cc@example.com" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => ccFields.remove(idx)}
                          >
                            <Trash2Icon className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    {/* BCC */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-secondary">BCC</span>
                        <button
                          type="button"
                          className="text-xs flex items-center gap-1 hover:underline"
                          style={{ color: 'var(--pnf-blue-light, #5ba3f5)' }}
                          onClick={() => bccFields.append({ value: '' })}
                        >
                          <PlusIcon className="h-3 w-3" /> Add
                        </button>
                      </div>
                      {bccFields.fields.map((field, idx) => (
                        <div key={field.id} className="flex gap-2">
                          <FormField
                            control={form.control}
                            name={`email.bcc.${idx}.value`}
                            render={({ field: f }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input {...f} className="h-8 text-sm" placeholder="bcc@example.com" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => bccFields.remove(idx)}
                          >
                            <Trash2Icon className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[11px] text-text-tertiary bg-bg-surface rounded-md px-3 py-2 border border-border-subtle">
                  A test message will be sent when you proceed to the next step to confirm the
                  channel is working correctly.
                </p>
              </form>
            </Form>
          )}

          {step === 'verify' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text-secondary">
                A test message has been sent to your channel. Confirm you received it before
                saving.
              </p>

              {isTesting && (
                <div className="flex items-center gap-2 text-sm text-text-tertiary">
                  <LoaderIcon className="animate-spin h-4 w-4" />
                  Sending test message…
                </div>
              )}

              {!isTesting && testResult === 'sent' && (
                <div className="text-sm text-green-400">
                  Test message sent successfully. Check your channel.
                </div>
              )}

              {!isTesting && testResult === 'error' && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-red-400">Failed to send test message.</p>
                  {testError && (
                    <p className="text-[11px] text-red-300">{testError}</p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 w-fit"
                    onClick={runTest}
                  >
                    Retry Test
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-4 pb-4 pt-2 border-t border-border-subtle">
          {step === 'configure' && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleNext}
                disabled={!isValid || smtpMissing || isLoadingSmtp || (isEdit && isLoadingConfig)}
              >
                Next
              </Button>
            </>
          )}

          {step === 'verify' && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleVerifyBack}
                disabled={isTesting}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={handleVerifyDone}
                disabled={isTesting || isSaving}
              >
                {isSaving && <LoaderIcon className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
            </>
          )}
        </DialogFooter>

        {isCancelling && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
            <div className="bg-bg-elevated p-4 rounded-lg w-[300px]">
              <h3 className="text-lg font-medium mb-2">Discard changes?</h3>
              <p className="mb-4 text-sm">
                You have unsaved changes. Are you sure you want to discard them?
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCancelling(false)}>
                  Continue Editing
                </Button>
                <Button variant="destructive" onClick={() => onClose(false)}>
                  Discard
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
