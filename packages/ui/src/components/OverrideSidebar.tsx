import React from 'react'

export default function OverrideSidebar({children}: React.PropsWithChildren) {
  return (
    <div className={'w-[100vw] bg-bg-root fixed left-0 top-0 h-dvh z-20 overflow-y-auto'}>
      {children}
    </div>
  )
}