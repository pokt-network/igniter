'use client'

import React from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@igniter/ui/components/popover'
import { Checkbox } from '@igniter/ui/components/checkbox'
import { Input } from '@igniter/ui/components/input'
import { Button } from '@igniter/ui/components/button'

/**
 * A select-sized trigger that opens a searchable checklist of services; none checked means all. With some picked,
 * an x on the trigger clears them.
 */
export default function ServicesFilter({
  services,
  value,
  onChange,
  bare = false,
}: {
  services: string[]
  value: string[]
  onChange: (next: string[]) => void
  /** Borderless, for a segment of the controls bar. */
  bare?: boolean
}) {
  const [query, setQuery] = React.useState('')
  const shown = services.filter((s) => s.toLowerCase().includes(query.trim().toLowerCase()))
  const selected = new Set(value)
  const toggle = (s: string) => onChange(selected.has(s) ? value.filter((v) => v !== s) : [...value, s].sort())
  // No count with "All": the list spans every retained day, while the header counts the period's services, and two
  // different counts side by side read as an error.
  const label = value.length === 0 ? 'All services' : value.length === 1 ? value[0] : `${value.length} services`
  const frame = bare
    ? 'h-7 min-w-40 bg-transparent font-semibold focus:outline-none'
    : 'h-9 min-w-44 rounded-md border border-border-primary bg-bg-input pl-3 shadow-sm focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus/30'

  return (
    <Popover>
      <div className="relative">
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`flex items-center justify-between gap-2 whitespace-nowrap text-sm text-text-primary ${frame} ${value.length > 0 ? 'pr-16' : bare ? 'pr-0' : 'pr-3'}`}
          >
            <span className={value.length === 0 && !bare ? 'text-text-secondary' : ''}>{label}</span>
            {value.length === 0 && <ChevronDown className="h-4 w-4 opacity-50" />}
          </button>
        </PopoverTrigger>
        {value.length > 0 && (
          <div className={`absolute inset-y-0 ${bare ? 'right-0' : 'right-2'} flex items-center gap-1`}>
            <button
              type="button"
              aria-label="Clear services"
              title="Clear services"
              onClick={() => onChange([])}
              className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-bg-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-border-focus/30"
            >
              <X className="h-4 w-4" />
            </button>
            <ChevronDown className="h-4 w-4 opacity-50 pointer-events-none" />
          </div>
        )}
      </div>
      <PopoverContent align="start" className="w-64 p-0 bg-bg-surface">
        <div className="p-2 border-b border-border-primary">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a service" className="h-8 text-sm" />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {shown.length === 0 && <p className="px-3 py-2 text-sm text-text-tertiary">No service matches.</p>}
          {shown.map((s) => (
            <label key={s} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-bg-hover">
              <Checkbox checked={selected.has(s)} onCheckedChange={() => toggle(s)} />
              {s}
            </label>
          ))}
        </div>
        {value.length > 0 && (
          <div className="p-2 border-t border-border-primary flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => onChange([])}>Show all services</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
