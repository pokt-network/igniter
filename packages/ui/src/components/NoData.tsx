import { CircleAlert } from 'lucide-react'
import React from 'react'

interface NoDataProps {
  label: string
}

export default function NoData({label}: NoDataProps) {
  return (
    <div className={'flex flex-col items-center justify-center h-full min-h-[300px] px-4'}>
      <CircleAlert className={"h-12 w-12 sm:h-16 sm:w-16 text-text-tertiary"}/>
      <p className={"text-sm sm:text-md text-center font-semibold my-3 text-text-tertiary"}>
        {label}
      </p>
    </div>
  )
}
