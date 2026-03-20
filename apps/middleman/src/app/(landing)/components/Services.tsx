import {Button} from "@igniter/ui/components/button";

export default function Services() {
    return (
        <div className="flex flex-row items-center px-[59px] justify-between h-[154px] bg-bg-surface border-b border-border-primary">
            <span className="font-[var(--font-sans)] text-[23px] leading-[2.09] text-text-primary">
              Non-Custodial Staking. Get Started Now.
            </span>
            <Button variant={'secondary'}>Connect Wallet</Button>
        </div>
    );
}
