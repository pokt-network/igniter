import { toCurrencyFormat } from '../lib/utils'

interface AmountProps {
  value: number;
  maxFractionDigits?: number;
  minimumFractionDigits?: number;
}

// TODO: Consume unit price context to display the correct currency between USD and POKT

export default function Amount({value, maxFractionDigits = 2, minimumFractionDigits = 2}: AmountProps) {
  return (
    <span className={'text-[inherit] font-mono'}>
      {toCurrencyFormat(value, maxFractionDigits, minimumFractionDigits)}{' '}
      <span className={'text-text-tertiary'}>
        $POKT
      </span>
    </span>
  )
}
