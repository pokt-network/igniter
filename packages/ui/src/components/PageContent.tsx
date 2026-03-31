import React from 'react'

interface PageContentProps {
  children: React.ReactNode
  className?: string
}

export default function PageContent({ children, className }: Readonly<PageContentProps>) {
  return (
    <div className={`flex flex-col p-4 w-full gap-4 md:gap-6 sm:px-3 md:px-6 lg:px-6 xl:px-10 ${className || ''}`}>
      {children}
    </div>
  )
}
