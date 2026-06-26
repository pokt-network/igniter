import { Badge } from '@igniter/ui/components/badge'
import { TransactionStatus } from '@igniter/db/middleman/enums'

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'destructive' | 'secondary'> = {
  [TransactionStatus.Pending]: 'warning',
  [TransactionStatus.Success]: 'success',
  [TransactionStatus.Failure]: 'destructive',
  [TransactionStatus.NotExecuted]: 'secondary',
}

const STATUS_LABEL: Record<string, string> = {
  [TransactionStatus.Pending]: 'Pending',
  [TransactionStatus.Success]: 'Success',
  [TransactionStatus.Failure]: 'Failed',
  [TransactionStatus.NotExecuted]: 'Not Executed',
}

export function transactionStatusBadge(status: string): { variant: 'warning' | 'success' | 'destructive' | 'secondary'; label: string } {
  return {
    variant: STATUS_VARIANT[status] ?? 'secondary',
    label: STATUS_LABEL[status] ?? status,
  }
}

export function TransactionStatusBadge({ status }: { status: string }) {
  const { variant, label } = transactionStatusBadge(status)
  return <Badge variant={variant}>{label}</Badge>
}
