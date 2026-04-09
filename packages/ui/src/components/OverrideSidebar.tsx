import React from 'react'

export default function OverrideSidebar({children}: React.PropsWithChildren) {
  return (
    <div className={'w-[100vw] bg-bg-root fixed left-0 top-[var(--notification-height,0px)] h-[calc(100dvh-var(--notification-height,0px))] z-20 overflow-y-auto'}>
      {children}
    </div>
  )
}