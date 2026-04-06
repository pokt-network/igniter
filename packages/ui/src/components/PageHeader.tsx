import React from 'react'

interface PageHeaderProps {
  title: string
  subtitle: string
  actions?: React.ReactNode
}

export default function PageHeader({ title, subtitle, actions }: Readonly<PageHeaderProps>) {
  return (
    <div className="border-b-1">
      <div className="px-5 sm:px-3 md:px-6 lg:px-6 xl:px-10 py-6">
        <div className="flex flex-row justify-between items-center">
          <div className="flex flex-col">
            <h1>{title}</h1>
            <p className="text-text-secondary">{subtitle}</p>
          </div>
          {actions && (
            <div className="flex flex-row gap-3 items-center">
              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
