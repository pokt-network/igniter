import { LoaderIcon } from '@igniter/ui/assets'

export default function Loading() {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[400px]">
      <LoaderIcon className="w-8 h-8 animate-spin text-[var(--color-white-3)]" />
    </div>
  )
}
