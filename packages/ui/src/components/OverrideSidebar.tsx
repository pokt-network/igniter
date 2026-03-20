import React from 'react'

export default function OverrideSidebar({children}: React.PropsWithChildren) {
  return (
    <div className={'w-[100vw] bg-bg-root absolute top-0 left-0 md:left-[-256px] min-h-[100vh] z-20'}>
      {children}
    </div>
  )
}
