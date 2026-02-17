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
    <div className="flex flex-col w-[580px] border-x border-b border-[--black-dividers] bg-[--black-1] p-[33px] rounded-b-[12px] gap-8">
      <ActivityHeader
        title="Import Complete!"
        subtitle="Your suppliers have been successfully imported."
        onClose={onClose}
      />

      <div className="relative flex h-[64px] gradient-border-green">
        <div className="absolute inset-0 flex flex-row items-center m-[0.5px] bg-[var(--background)] rounded-[8px] p-[18px_25px] justify-between">
          <span className="text-[20px] text-[var(--color-white-3)]">
            Imported
          </span>
          <span className="flex flex-row items-center gap-2">
            <span className="font-mono text-[20px] text-[var(--color-white-1)]">
              {importedSuppliers.length} supplier
              {importedSuppliers.length !== 1 ? 's' : ''}
            </span>
          </span>
        </div>
      </div>

      <div className="flex flex-col bg-[var(--color-slate-2)] p-0 rounded-[8px]">
        <span className="text-[14px] text-[var(--color-white-3)] p-[11px_16px]">
          Your suppliers have been imported and are now managed by your account.
          You can view them in the Suppliers page.
        </span>
      </div>

      <div className="flex flex-col p-0 rounded-[8px] border border-[var(--black-dividers)]">
        <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
          <span className="text-[14px] text-[var(--color-white-3)]">
            Provider
          </span>
          <span className="text-[14px] text-[var(--color-white-1)]">
            {providerName}
          </span>
        </span>

        <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
          <span className="text-[14px] text-[var(--color-white-3)]">
            Total Suppliers
          </span>
          <span className="text-[14px] text-[var(--color-white-1)]">
            {importedSuppliers.length}
          </span>
        </span>

        <span className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]">
          <span className="text-[14px] text-[var(--color-white-3)]">
            Total Staked
          </span>
          <span className="font-mono text-[14px] text-[var(--color-white-1)]">
            <Amount value={totalStakedPokt} />
          </span>
        </span>

        <span
          className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)] cursor-pointer"
          onClick={() => setIsShowingSuppliers(!isShowingSuppliers)}
        >
          <span className="flex flex-row items-center gap-2">
            <CaretSmallIcon
              className={`transform transition-transform ${
                isShowingSuppliers ? 'rotate-90' : ''
              }`}
            />
            <span className="text-[14px] text-[var(--color-white-3)]">
              Supplier Details ({importedSuppliers.length})
            </span>
          </span>
        </span>

        {isShowingSuppliers &&
          importedSuppliers.map((supplier, index) => (
            <span
              key={supplier.address}
              className="flex flex-row items-center justify-between px-4 py-3 border-b border-[var(--black-dividers)]"
            >
              <span className="flex flex-col gap-1">
                <span className="text-[14px] text-[var(--color-white-3)]">
                  Supplier {index + 1}
                </span>
                <span className="text-[12px] text-gray-400 font-mono">
                  {getShortAddress(supplier.address, 8)}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="font-mono text-[14px] text-[var(--color-white-1)]">
                  <Amount value={Number(supplier.stakeAmount) / 1e6} />
                </span>
                <span className="text-[10px] text-gray-400">
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
