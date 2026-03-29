'use client'

import React, { useState } from 'react'
import { Button } from '@igniter/ui/components/button'
import ImportForm from './import/ImportForm'
import ExportForm from './export/ExportForm'
import GenerateForm from './generate/GenerateForm'

export default function KeyActions() {
  const [activeModal, setActiveModal] = useState<
    'import' | 'export' | 'generate' | null
  >(null)

  return (
    <>
      <Button onClick={() => setActiveModal('import')}>Import</Button>
      <Button
        className="bg-pnf-mint text-gray-900 border-transparent hover:opacity-90"
        onClick={() => setActiveModal('export')}
      >
        Export
      </Button>
      <Button
        className="bg-pnf-mint text-gray-900 border-transparent hover:opacity-90"
        onClick={() => setActiveModal('generate')}
      >
        Generate
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
    </>
  )
}
