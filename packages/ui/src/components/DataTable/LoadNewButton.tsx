'use client'

interface LoadNewButtonProps {
  count: number
  onClick: () => void
}

export default function LoadNewButton({ count, onClick }: Readonly<LoadNewButtonProps>) {
  if (count <= 0) return null

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 whitespace-nowrap h-9 px-4 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors cursor-pointer"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
      +{count} new
    </button>
  )
}
