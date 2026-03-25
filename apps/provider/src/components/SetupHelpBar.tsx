import React from 'react'

interface SetupHelpBarProps {
  docAnchor: string
  children?: React.ReactNode
}

const DOCS_BASE_URL = 'https://github.com/pokt-network/igniter/blob/main/docs/guides/provider/bootstrap.md'

export function SetupHelpBar({ docAnchor, children }: SetupHelpBarProps) {
  return (
    <div
      className="flex items-center justify-between rounded-lg px-4 py-3 mt-2"
      style={{ background: 'var(--bg-surface, rgba(255,255,255,0.03))', border: '1px solid var(--border-primary)' }}
    >
      <div className="flex items-center gap-3">
        {children}
      </div>
      <a
        href={`${DOCS_BASE_URL}#${docAnchor}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs transition-colors hover:brightness-125"
        style={{ color: 'var(--pnf-blue-light, #5ba3f5)' }}
      >
        Need help? Read the setup guide
      </a>
    </div>
  )
}
