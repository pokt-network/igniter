import React from "react";
import {RemediationHistoryEntry} from "@igniter/db/provider/schema";
import {KeyState, RemediationHistoryEntryReason, TransactionResult} from "@igniter/db/provider/enums";
import {useRouter} from "next/navigation";
import {UpdateKeysState} from "@/actions/Keys";
import {ActionButton} from "@/app/admin/details/KeyDetail/ActionButton";
import {ConfirmationDialog} from "@igniter/ui/components/ConfirmationDialog";
import {Button} from "@igniter/ui/components/button";
import { copyToClipboard } from "@igniter/ui/lib/utils";

export function RemediationHistoryList({ entries, keyId, keyState }: { entries: RemediationHistoryEntry[]; keyId: number, keyState: KeyState }) {

  if (entries.length === 0) return null;

  const reasonLabel = (r: RemediationHistoryEntryReason) => {
    switch (r) {
      case RemediationHistoryEntryReason.ServiceMismatch:
        return 'Service mismatch'
      case RemediationHistoryEntryReason.DelegatorAddressMissing:
        return 'Delegator address missing'
      case RemediationHistoryEntryReason.OwnerInitialStake:
        return 'Owner initial stake'
      case RemediationHistoryEntryReason.SupplierStakeTooLow:
        return "Supplier's stake too low"
      case RemediationHistoryEntryReason.SupplierFundsTooLow:
        return "Supplier's funds too low"
      case RemediationHistoryEntryReason.AddressGroupMigration:
        return 'Address group migration'
      default:
        return String(r)
    }
  }

  const toMs = React.useCallback((t: number) => (t < 1e12 ? t * 1000 : t), [])

  const formatWhen = React.useCallback((t: number) => {
    const now = Date.now()
    const diff = now - t
    const oneMinute = 60 * 1000
    const oneHour = 60 * oneMinute
    const oneDay = 24 * oneHour
    if (diff < oneDay) {
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
      if (diff < oneMinute) return rtf.format(Math.round((t - now) / 1000), 'second')
      if (diff < oneHour) return rtf.format(Math.round((t - now) / oneMinute), 'minute')
      return rtf.format(Math.round((t - now) / oneHour), 'hour')
    }
    return new Date(t).toLocaleString()
  }, [])

  const sorted = React.useMemo(() => [...entries].sort((a, b) => b.timestamp - a.timestamp), [entries])

  const CollapsibleText = ({ text, limit = 220, className }: { text: string; limit?: number; className?: string }) => {
    const [expanded, setExpanded] = React.useState(false)
    if (!text) return null
    if (text.length <= limit) return <div className={className}>{text}</div>
    const shown = expanded ? text : text.slice(0, limit) + '…'
    return (
      <div className={className}>
        <span>{shown}</span>
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          className="ml-1 underline opacity-80 hover:opacity-100"
          aria-label={expanded ? 'Show less' : 'Show more'}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      </div>
    )
  }

  const formatClipboardText = React.useCallback((e: RemediationHistoryEntry) => {
    const ms = toMs(e.timestamp)
    const code = String(e.reason)
    const title = reasonLabel(e.reason)
    const time = new Date(ms).toLocaleString()
    const line1 = `[${code}] ${title}  ${time}`
    const line2 = (e.message ?? '').trim()
    const line3 = (e.details ?? e.txResultDetails ?? '').trim()
    return [line1, line2, line3].filter(Boolean).join('\n')
  }, [toMs])

  const CopyEntryButton = ({ text }: { text: string }) => {
    const [copied, setCopied] = React.useState(false)

    const copy = async () => {
      await copyToClipboard(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }

    return (
      <Button
        type="button"
        onClick={copy}
        className="h-[22px] px-2 text-[11px] bg-transparent border border-border-primary hover:bg-bg-elevated"
        aria-label="Copy entry"
        title={copied ? 'Copied' : 'Copy'}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    )
  }

  const router = useRouter()
  const [showConfirm, setShowConfirm] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const onRequestRemediation = () => setShowConfirm(true)

  const handleConfirm = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      await UpdateKeysState([keyId], KeyState.Staked)
      setShowConfirm(false)
      router.refresh()
    } catch (e) {
      console.error('Failed to clear remediation state', e)
      setError(e instanceof Error ? e.message : 'Failed to update key state. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {[KeyState.AttentionNeeded, KeyState.RemediationFailed].includes(keyState) && (
        <ActionButton onClick={onRequestRemediation} disabled={isSubmitting}>
          Clear remediation
        </ActionButton>
      )}

      <ConfirmationDialog
        title="Clear remediation"
        open={showConfirm}
        onClose={() => { if (!isSubmitting) setShowConfirm(false) }}
        footerActions={(
          <>
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={isSubmitting} type="button">
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isSubmitting}>
              {isSubmitting ? 'Confirming…' : 'Confirm'}
            </Button>
          </>
        )}
      >
        {error && (
          <div className="px-4 py-2 text-[12px] text-red-400 bg-bg-root">
            {error}
          </div>
        )}
        <div className="py-3 text-[14px] text-text-secondary">
          This will reset the key state back to <span className="font-semibold">Staked</span>. The system will re-evaluate it on the next status check.
        </div>
      </ConfirmationDialog>

      <div className="flex flex-col bg-bg-elevated p-0 rounded-[8px]">
        <div className="text-[12px] text-text-secondary p-[8px_12px]">Remediation history</div>
        <div className="flex flex-col">
          {sorted.map((e, idx) => {
            const ms = toMs(e.timestamp)
            const when = formatWhen(ms)
            return (
              <div key={`${e.timestamp}-${e.reason}-${idx}`} className="p-[8px_12px] text-[12px] text-text-secondary border-t border-border-primary first:border-t-0">
                <div className="flex flex-row items-start justify-between gap-2 opacity-80">
                  <div className="flex flex-row items-center gap-2">
                    <span className="font-semibold">[{String(e.reason)}]</span>
                    <span>{reasonLabel(e.reason)}</span>
                  </div>
                  <div className="flex flex-row items-center gap-2">
                    <span className="font-mono" title={new Date(ms).toLocaleString()}>{when}</span>
                    <CopyEntryButton text={formatClipboardText(e)} />
                  </div>
                </div>
                <div className="mt-1">{e.message}</div>
                {e.details && (
                  <div className="opacity-80 break-words whitespace-pre-wrap">{e.details}</div>
                )}
                {typeof e.txResult !== 'undefined' && (
                  <div className="opacity-80">tx: {TransactionResult[e.txResult]}</div>
                )}
                {e.txResultDetails && (
                  <div className="mt-1">
                    <CollapsibleText
                      text={e.txResultDetails}
                      className="opacity-80 font-mono whitespace-pre-wrap break-words"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}