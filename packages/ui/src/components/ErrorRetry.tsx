import { CircleX } from 'lucide-react'
import { Button } from './button'

interface ErrorRetryProps {
  onRetry?: () => void
  errorMessage?: string
}

export default function ErrorRetry({
  onRetry,
  errorMessage = "Oops. There was an error loading the data."
}: ErrorRetryProps) {

  return (
    <div className="grow flex flex-col justify-center items-center">
      <CircleX className="text-error mb-2 h-8 w-8" />
      <p className="tracking-wide">{errorMessage}</p>
      <Button onClick={onRetry} className={'my-2 h-[26px]'}>
        Retry
      </Button>
    </div>
  )
}
