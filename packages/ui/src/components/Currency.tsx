import { cva } from 'class-variance-authority';
import {toCurrencyFormat} from "../lib/utils";

export interface CurrencyProps {
    amount: number;
    variant?: 'small' | 'large';
    maxFractionDigits?: number;
    className?: string;
}

const currencyStyles = cva('font-mono', {
    variants: {
        variant: {
            small: 'flex items-center text-[14px] font-mono text-text-primary',
            large: 'flex items-center text-[20px] font-mono text-text-primary',
        },
    },
    defaultVariants: {
        variant: 'small',
    },
});

export default function Currency({ amount, variant, maxFractionDigits }: Readonly<CurrencyProps>) {
    return (
        <span className={currencyStyles({ variant })}>
            {toCurrencyFormat(amount, maxFractionDigits)}
        </span>
    );
}
