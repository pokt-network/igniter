'use client'
import {ActivityHeader} from "@igniter/ui/components/ActivityHeader";
import {ActivityContentLoading} from '@/app/app/stake/components/ActivityContentLoading'

export default function Loading() {
  return (
    <div
      className="h-[305px] flex flex-col w-[480px] border-x border-b border-border-primary bg-bg-root p-[33px] rounded-b-[12px] gap-8"
    >
      <ActivityHeader
        title="Stake"
        subtitle="Loading..."
        onClose={() => {}}
        isDisabled={true}
      />

      <div className={'flex items-center justify-center w-full h-full mt-[-60px]'}>
        <div className={'scale-200'}>
          <ActivityContentLoading />
        </div>
      </div>
    </div>
  )
}
