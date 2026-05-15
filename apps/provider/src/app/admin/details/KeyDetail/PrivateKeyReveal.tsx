'use client'

import React, {useState, useRef, useCallback} from 'react'
import {clsx} from 'clsx'
import {Button} from '@igniter/ui/components/button'
import {LoaderIcon, WarningIcon, CopyIcon, CheckSuccess as CheckIcon} from '@igniter/ui/assets'
import {RevealPrivateKey} from '@/actions/Keys'
import { copyToClipboard } from '@igniter/ui/lib/utils'

const AUTO_HIDE_SECONDS = 30

function EyeIcon({className}: {className?: string}) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  )
}

function EyeOffIcon({className}: {className?: string}) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  )
}

export default function PrivateKeyReveal({keyId}: {keyId: number}) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'loading' | 'revealed' | 'error'>('idle')
  const [privateKey, setPrivateKey] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(AUTO_HIDE_SECONDS)
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined)

  const hide = useCallback(() => {
    setPrivateKey(null)
    setVisible(false)
    setStep('idle')
    setSecondsLeft(AUTO_HIDE_SECONDS)
    clearInterval(timerRef.current)
  }, [])

  const handleReveal = async () => {
    setStep('loading')
    try {
      const result = await RevealPrivateKey(keyId)
      if (!result?.success) throw new Error('Failed to fetch private key')
      setPrivateKey(result.data)
      setVisible(false)
      setStep('revealed')
      setSecondsLeft(AUTO_HIDE_SECONDS)
      timerRef.current = setInterval(() => {
        setSecondsLeft(prev => {
          if (prev <= 1) {
            hide()
            return AUTO_HIDE_SECONDS
          }
          return prev - 1
        })
      }, 1000)
    } catch {
      setStep('error')
    }
  }

  const handleCopy = () => {
    if (!privateKey) return
    copyToClipboard(privateKey).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1500)
    })
  }

  if (step === 'idle') {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setStep('confirm')}
      >
        View Private Key
      </Button>
    )
  }

  if (step === 'confirm') {
    return (
      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <WarningIcon className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-primary">Reveal Private Key</p>
            <p className="text-xs text-text-secondary">
              Your private key grants full control over this key. Never share it with anyone. It will be hidden automatically after {AUTO_HIDE_SECONDS} seconds.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setStep('idle')} className="flex-1">
            Cancel
          </Button>
          <Button size="sm" onClick={handleReveal} className="flex-1">
            I understand, reveal key
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'loading') {
    return (
      <div className="flex items-center justify-center py-4">
        <LoaderIcon className="animate-spin h-5 w-5 text-text-secondary" />
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
        <p className="text-sm text-red-400">Failed to retrieve private key.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={hide}>
            Close
          </Button>
          <Button size="sm" onClick={handleReveal}>
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">Private Key</span>
        <span className="text-xs text-text-tertiary">auto-hide in {secondsLeft}s</span>
      </div>
      <div className="flex items-center gap-2">
        <code className={clsx(
          "flex-1 text-xs font-mono bg-[#0d1117] rounded px-3 py-2 break-all border border-border",
          visible && "select-all"
        )}>
          {visible ? privateKey : '\u2022'.repeat(64)}
        </code>
        <Button variant="icon" className="h-8 w-8 shrink-0" onClick={() => setVisible(v => !v)} title={visible ? 'Hide' : 'Reveal'}>
          {visible ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
        </Button>
        <Button variant="icon" className="h-8 w-8 shrink-0" onClick={handleCopy}>
          {isCopied ? <CheckIcon /> : <CopyIcon style={{marginTop: '2px'}} />}
        </Button>
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={hide}>
        Hide
      </Button>
    </div>
  )
}
