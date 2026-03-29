import React from 'react'

export default function OverrideSidebar({children}: React.PropsWithChildren) {
  return (
    <div className={'w-[100vw] bg-bg-root absolute top-0 left-0 md:left-[-208px] h-[100vh] overflow-auto z-20'}>
      {children}
    </div>
  )
}
