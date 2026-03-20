'use client';

import React from 'react'
import { QuickInfoPopOverIcon } from './QuickInfoPopOverIcon'

export interface SummaryRow {
  label: React.ReactNode;
  description?: React.ReactNode;
  value?: React.ReactNode;
}

interface SummaryProps {
  rows: Array<SummaryRow>;
}

export default function Summary({
  rows
}: SummaryProps) {
  return (
    <div className="flex flex-col p-0 rounded-[8px] border border-border-primary">
      {rows.map((row, index) => (
        <div key={index} className="flex flex-row items-center justify-between px-4 py-3 border-b border-border-primary last:border-none">
          <div className="flex flex-row items-center gap-2 text-[14px] text-text-tertiary">
            {typeof row.label === 'string' ? (
              <span>
                {row.label}
              </span>
            ) : row.label}
            {row.description && (
              <QuickInfoPopOverIcon
                title={row.label}
                description={row.description}
                url={''}
              />
            )}
          </div>
          {typeof row.value === 'string' ? (
            <span className="text-[14px] text-text-primary">
              {row.value}
            </span>
          ) : row.value}
        </div>
      ))}
    </div>
  )
}
