'use client'

import { useState } from 'react'
import { Button } from '@igniter/ui/components/button'
import { ActivityHeader } from '@igniter/ui/components/ActivityHeader'
import { LoaderIcon, CaretSmallIcon } from '@igniter/ui/assets'
import { getShortAddress } from '@igniter/ui/lib/utils'
import Amount from '@igniter/ui/components/Amount'
import { ImportedSupplier } from '@/lib/services/importSuppliers'

interface ImportSuccessStepProps {
  importedSuppliers: ImportedSupplier[]
  providerName: string
  onClose: () => void
}

export function ImportSuccessStep({
  importedSuppliers,
  providerName,
  onClose,
}: ImportSuccessStepProps) {
  const [isShowingSuppliers, setIsShowingSuppliers] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)

  const totalStaked = importedSuppliers.reduce(
    (acc, s) => acc + BigInt(s.stakeAmount),
    BigInt(0),
  )
  const totalStakedPokt = Number(totalStaked) / 1e6

  return (
    <div className="flex flex-col w-[580px] border-x border-b border-border-primary bg-bg-root p-[33px] rounded-b-[12px] gap-8">
      <ActivityHeader
        title="Import Complete!"
        subtitle="Your suppliers have been successfully imported."
        onClose={onClose}
      />

      <div className="relative flex h-[64px] gradient-border-green">
        <div className="absolute inset-0 flex flex-row items-center m-[0.5px] bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between">
          <span className="text-[20px] text-[var(--text-tertiary)]">
            Imported
          </span>
          <span className="flex flex-row items-center gap-2">
            <span className="font-mono text-[20px] text-[var(--text-primary)]">
              {importedSuppliers.length} supplier
              {importedSuppliers.length !== 1 ? 's' : ''}
            </span>
          </span>
        </div>
      </div>

      <div className="flex flex-col bg-[var(--bg-surface)] p-0 rounded-[8px]">
        <span className="text-[14px] text-[var(--text-tertiary)] p-[11px_16px]">
          Your suppliers have been imported and are now managed by your account.
          You can view them in the Suppliers page.
        </span>
      </div>

      <div className="flex flex-col p-0 rounded-[8px] border border-[var(--border-primary)]">
        <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
          <span className="text-[14px] text-[var(--text-tertiary)]">
            Provider
          </span>
          <span className="text-[14px] text-[var(--text-primary)]">
            {providerName}
          </span>
        </span>

        <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
          <span className="text-[14px] text-[var(--text-tertiary)]">
            Total Suppliers
          </span>
          <span className="text-[14px] text-[var(--text-primary)]">
            {importedSuppliers.length}
          </span>
        </span>

        <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
          <span className="text-[14px] text-[var(--text-tertiary)]">
            Total Staked
          </span>
          <span className="font-mono text-[14px] text-[var(--text-primary)]">
            <Amount value={totalStakedPokt} />
          </span>
        </span>

        <span
          className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] cursor-pointer"
          onClick={() => setIsShowingSuppliers(!isShowingSuppliers)}
        >
          <span className="flex flex-row items-center gap-2">
            <CaretSmallIcon
              className={`transform transition-transform ${
                isShowingSuppliers ? 'rotate-90' : ''
              }`}
            />
            <span className="text-[14px] text-[var(--text-tertiary)]">
              Supplier Details ({importedSuppliers.length})
            </span>
          </span>
        </span>

        {isShowingSuppliers &&
          importedSuppliers.map((supplier, index) => (
            <span
              key={supplier.address}
              className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]"
            >
              <span className="flex flex-col gap-1">
                <span className="text-[14px] text-[var(--text-tertiary)]">
                  Supplier {index + 1}
                </span>
                <span className="text-[12px] text-text-tertiary font-mono">
                  {getShortAddress(supplier.address, 8)}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="font-mono text-[14px] text-[var(--text-primary)]">
                  <Amount value={Number(supplier.stakeAmount) / 1e6} />
                </span>
                <span className="text-[10px] text-text-tertiary">
                  {supplier.services.length} service
                  {supplier.services.length !== 1 ? 's' : ''}
                </span>
              </span>
            </span>
          ))}
      </div>

      <Button
        className="w-full h-[40px]"
        onClick={() => {
          setIsRedirecting(true)
          onClose()
        }}
      >
        {isRedirecting ? (
          <LoaderIcon className="animate-spin" />
        ) : (
          'Go to Suppliers'
        )}
      </Button>
    </div>
  )
}
