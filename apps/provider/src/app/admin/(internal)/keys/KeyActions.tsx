'use client'

import React, { useState } from 'react'
import { Button } from '@igniter/ui/components/button'
import ImportForm from './import/ImportForm'
import ExportForm from './export/ExportForm'
import GenerateForm from './generate/GenerateForm'
import MigrateForm from './migrate/MigrateForm'
import UnstakeForm from './unstake/UnstakeForm'

interface KeyActionsProps {
  returnFundsDefault?: boolean
}

export default function KeyActions({ returnFundsDefault = false }: KeyActionsProps) {
  const [activeModal, setActiveModal] = useState<
    'import' | 'export' | 'generate' | 'migrate' | 'unstake' | null
  >(null)

  return (
    <>
      <Button onClick={() => setActiveModal('import')}>Import</Button>
      <Button
        className="bg-pnf-mint text-gray-900 border-transparent hover:opacity-90"
        onClick={() => setActiveModal('generate')}
      >
        Generate
      </Button>
      <Button
        variant="outline"
        onClick={() => setActiveModal('export')}
      >
        Export
      </Button>
      <Button
        variant="outline"
        onClick={() => setActiveModal('migrate')}
      >
        Migrate
      </Button>
      <Button
        variant="outline"
        onClick={() => setActiveModal('unstake')}
      >
        Unstake
      </Button>

      {activeModal === 'import' && (
        <ImportForm onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'export' && (
        <ExportForm onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'generate' && (
        <GenerateForm onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'migrate' && (
        <MigrateForm onClose={() => setActiveModal(null)} />
      )}
      {activeModal === 'unstake' && (
        <UnstakeForm onClose={() => setActiveModal(null)} returnFundsDefault={returnFundsDefault} />
      )}
    </>
  )
}
