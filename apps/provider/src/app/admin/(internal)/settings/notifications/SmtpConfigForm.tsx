'use client'

import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@igniter/ui/components/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@igniter/ui/components/form'
import { Input } from '@igniter/ui/components/input'
import { LoaderIcon } from '@igniter/ui/assets'
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react'
import {
  GetSmtpConfiguration,
  UpsertSmtpConfiguration,
  DeleteSmtpConfiguration,
  TestSmtpConfiguration,
} from '@/actions/SmtpConfiguration'
import { useNotifications } from '@igniter/ui/context/Notifications/index'
import { Switch } from '@igniter/ui/components/switch'
import { Label } from '@igniter/ui/components/label'

// Password is only required when there is no saved configuration yet; when
// editing an existing one, leaving it blank keeps the stored password.
const makeSmtpFormSchema = (hasExisting: boolean) =>
  z.object({
    host: z.string().min(1, 'Host is required'),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    secure: z.boolean().default(true),
    username: z.string().min(1, 'Username is required'),
    password: hasExisting ? z.string() : z.string().min(1, 'Password is required'),
    fromAddress: z.string().email('Please enter a valid email address'),
    fromName: z.string().max(255).optional(),
  })

type SmtpFormValues = z.infer<ReturnType<typeof makeSmtpFormSchema>>

export function SmtpConfigForm() {
  const queryClient = useQueryClient()
  const { addNotification } = useNotifications()
  const [isOpen, setIsOpen] = useState(false)
  const [showTestInput, setShowTestInput] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testEmailError, setTestEmailError] = useState<string | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const { data: smtpConfig, isLoading } = useQuery({
    queryKey: ['smtp-config'],
    queryFn: async () => {
      const result = await GetSmtpConfiguration()
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
  })

  const form = useForm<SmtpFormValues>({
    resolver: zodResolver(makeSmtpFormSchema(!!smtpConfig)),
    defaultValues: {
      host: '',
      port: 587,
      secure: true,
      username: '',
      password: '',
      fromAddress: '',
      fromName: '',
    },
    values: smtpConfig
      ? {
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          username: smtpConfig.username,
          // The server never returns the stored password; an empty value on
          // submit means "keep the current one"
          password: '',
          fromAddress: smtpConfig.fromAddress,
          fromName: smtpConfig.fromName ?? '',
        }
      : undefined,
  })

  const upsertMutation = useMutation({
    mutationFn: async (values: SmtpFormValues) => {
      const result = await UpsertSmtpConfiguration(values)
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-config'] })
      setIsOpen(false)
      addNotification({
        id: 'smtp-saved',
        type: 'success',
        showTypeIcon: true,
        content: 'SMTP configuration saved.',
      })
    },
    onError: (err) => {
      addNotification({
        id: 'smtp-save-error',
        type: 'error',
        showTypeIcon: true,
        content: err instanceof Error ? err.message : 'Failed to save SMTP configuration.',
      })
    },
  })

  const allValues = form.watch()
  const isDirty =
    JSON.stringify(allValues) !== JSON.stringify(form.formState.defaultValues)

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const result = await DeleteSmtpConfiguration()
      if (!result.success) throw new Error(result.error.message)
      queryClient.invalidateQueries({ queryKey: ['smtp-config'] })
      form.reset({ host: '', port: 587, secure: true, username: '', password: '', fromAddress: '', fromName: '' })
      addNotification({ id: 'smtp-deleted', type: 'success', showTypeIcon: true, content: 'SMTP configuration removed.' })
    } catch (err) {
      addNotification({ id: 'smtp-delete-error', type: 'error', showTypeIcon: true, content: err instanceof Error ? err.message : 'Failed to delete SMTP configuration.' })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleTest = async () => {
    const emailSchema = z.string().email()
    const parsed = emailSchema.safeParse(testEmail)
    if (!parsed.success) {
      setTestEmailError('Please enter a valid email address')
      return
    }
    setTestEmailError(null)
    setIsTesting(true)
    try {
      const values = form.getValues()
      const result = await TestSmtpConfiguration(testEmail, values)
      if (!result.success) throw new Error(result.error.message)
      addNotification({ id: 'smtp-test-sent', type: 'success', showTypeIcon: true, content: `Test email sent to ${testEmail}.` })
      setShowTestInput(false)
      setTestEmail('')
    } catch (err) {
      addNotification({ id: 'smtp-test-error', type: 'error', showTypeIcon: true, content: err instanceof Error ? err.message : 'Failed to send test email.' })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="rounded-md border border-border-subtle overflow-hidden">
      {/* Collapsible header */}
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-surface transition-colors text-left"
        onClick={() => setIsOpen((v) => !v)}
      >
        <div className="flex-1 flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-medium">SMTP Configuration</span>
          <span className="text-[11px] text-text-tertiary truncate">
            {isLoading
              ? 'Loading…'
              : smtpConfig
              ? `${smtpConfig.host}:${smtpConfig.port}`
              : 'Not configured — required for email channels'}
          </span>
        </div>
        {!isLoading && smtpConfig && (
          <span className="text-[11px] text-green-400 font-medium flex items-center gap-1 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            Configured
          </span>
        )}
        {!isLoading && !smtpConfig && (
          <span className="text-[11px] text-text-tertiary flex items-center gap-1 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-text-tertiary" />
            Not set
          </span>
        )}
        <ChevronDownIcon
          className={`h-4 w-4 text-text-tertiary transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Collapsible body */}
      {isOpen && (
        <div className="px-4 pb-4 pt-3 border-t border-border-subtle">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-text-tertiary py-2">
              <LoaderIcon className="animate-spin h-4 w-4" />
              Loading…
            </div>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((v) => upsertMutation.mutate(v))}
                className="flex flex-col gap-4"
              >
                {/* Host + Port + TLS in one row */}
                <div className="flex items-end gap-3">
                  <FormField
                    control={form.control}
                    name="host"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel className="text-sm">Host</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-9 text-sm" placeholder="smtp.example.com" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="port"
                    render={({ field }) => (
                      <FormItem className="w-20 shrink-0">
                        <FormLabel className="text-sm">Port</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" className="h-9 text-sm" placeholder="587" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="secure"
                    render={({ field }) => (
                      <FormItem className="shrink-0 pb-[2px]">
                        <div className="flex items-center gap-2 h-9">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              id="smtp-secure"
                            />
                          </FormControl>
                          <Label htmlFor="smtp-secure" className="text-sm cursor-pointer whitespace-nowrap">
                            TLS/SSL
                          </Label>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>

                {/* Username + Password */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Username</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-9 text-sm" placeholder="user@example.com" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">Password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            className="h-9 text-sm"
                            placeholder={smtpConfig ? 'Leave blank to keep current' : 'Enter password'}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* From Address + From Name */}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="fromAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">From Address</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-9 text-sm" placeholder="noreply@example.com" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="fromName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm">From Name <span className="text-text-tertiary font-normal">(optional)</span></FormLabel>
                        <FormControl>
                          <Input {...field} className="h-9 text-sm" placeholder="My Provider" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={upsertMutation.isPending || !isDirty || isDeleting}
                  >
                    {upsertMutation.isPending && (
                      <LoaderIcon className="mr-2 h-3.5 w-3.5 animate-spin" />
                    )}
                    {smtpConfig ? 'Save Changes' : 'Save'}
                  </Button>

                  {smtpConfig && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={upsertMutation.isPending || isDeleting || isTesting}
                        onClick={() => setShowTestInput((v) => !v)}
                      >
                        Send Test Email
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-400"
                        disabled={upsertMutation.isPending || isDeleting || isTesting}
                        onClick={handleDelete}
                      >
                        {isDeleting && <LoaderIcon className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Remove
                      </Button>
                    </>
                  )}
                </div>

                {/* Inline test email input */}
                {showTestInput && (
                  <div className="flex items-start gap-2 flex-wrap">
                    <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
                      <Input
                        value={testEmail}
                        onChange={(e) => { setTestEmail(e.target.value); setTestEmailError(null) }}
                        className="h-9 text-sm"
                        placeholder="recipient@example.com"
                        disabled={isTesting}
                      />
                      {testEmailError && (
                        <p className="text-[11px] text-red-400">{testEmailError}</p>
                      )}
                    </div>
                    <Button type="button" size="sm" onClick={handleTest} disabled={isTesting || !testEmail}>
                      {isTesting ? <LoaderIcon className="mr-2 h-3.5 w-3.5 animate-spin" /> : <CheckIcon className="mr-2 h-3.5 w-3.5" />}
                      Send
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setShowTestInput(false); setTestEmail(''); setTestEmailError(null) }}
                      disabled={isTesting}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </form>
            </Form>
          )}
        </div>
      )}
    </div>
  )
}