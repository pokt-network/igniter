import {Button} from "@igniter/ui/components/button";
import Currency from "@igniter/ui/components/Currency";

export interface AmountDisplayProps {
    balance: number;
    amount: number;
    minimumStake: number;
    onMaxSelected: () => void;
}

export function AmountDisplay({balance, amount, minimumStake, onMaxSelected}: Readonly<AmountDisplayProps>) {
    const nodes = minimumStake ? Math.floor(amount / minimumStake) : 0;

    return (
        <div className="flex flex-col w-full border border-border-primary rounded-[8px]">
            <div className="flex flex-row w-full h-[55px] bg-[#10161e] justify-between items-center p-4">
                <Currency amount={amount} variant="large" />
                <span className="flex flex-row items-center gap-3">
                    <Button
                        onClick={onMaxSelected}
                        className="h-[30px] text-[var(--text-primary)]"
                    >
                        Max
                    </Button>
                    <span className="text-[20px] text-[var(--text-tertiary)]">$POKT</span>
                </span>
            </div>
            <div className="flex flex-row items-center justify-between w-full h-[44px] border-t border-border-primary p-4">
                <span className="text-[var(--text-tertiary)]">
                    Balance
                </span>
                <span className="flex flex-row gap-1">
                    <Currency amount={balance} />
                    <span className="text-[14px] text-[var(--text-tertiary)]">$POKT</span>
                </span>
            </div>
            <div className="flex flex-row items-center justify-between w-full h-[44px] border-t border-border-primary p-4">
                <span className="text-[var(--text-tertiary)]">
                    Nodes
                </span>
                  <span className="flex flex-row gap-1">
                    <span className={'text-[14px] font-mono text-[var(--text-primary)]'}>
                        {nodes}
                    </span>
                </span>
              </div>
        </div>
    )
}
