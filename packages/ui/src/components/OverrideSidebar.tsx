import React from 'react'

export default function OverrideSidebar({children}: React.PropsWithChildren) {
  return (
    <div className={'w-[100vw] bg-bg-root fixed top-0 left-0 h-[100dvh] z-20 overflow-y-auto'}>
      {children}
    </div>
  )
}
