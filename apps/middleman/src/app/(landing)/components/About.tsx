import PoktscanNameLogo from '@/app/assets/icons/dark/institutions/poktscan.svg';
import PocketNameLogo from '@/app/assets/icons/dark/institutions/pocket.svg';

export default function About() {
    return (
        <div className="flex flex-col h-[521px] bg-bg-surface border-b border-border-primary">
            <div className="h-[329px] px-[59px] pt-[67px]">
                <div>
                    <span className="font-[var(--font-sans)] text-[30px] leading-[1.6] text-text-primary">
                        We Are Open Source
                    </span>
                </div>
                <div>
                    <span className="font-[var(--font-sans)] text-[27px] leading-[1.63] text-text-secondary">
                        Igniter is open source and powers Pocket Network's non-custodial staking.
                    </span>
                </div>
            </div>
            <div className="dashed-path-divider" />
            <div className="flex flex-row h-[192px]">
                <div className="relative flex flex-col w-[329px] h-full">
                    <div className="absolute top-[14px] right-[16px]">
                        <span className="font-[var(--font-mono)] text-[10px] text-text-tertiary uppercase">
                            product
                        </span>
                    </div>
                    <div className="flex justify-center items-center w-full h-full">
                        <PocketNameLogo />
                    </div>
                </div>
                <div className="relative flex flex-col w-[329px] h-full border-x border-border-primary">
                    <div className="absolute top-[14px] right-[16px]">
                        <span className="font-[var(--font-mono)] text-[10px] text-text-tertiary uppercase">
                            explorer
                        </span>
                    </div>
                    <div className="flex justify-center items-center w-full h-full">
                        <PoktscanNameLogo />
                    </div>
                </div>
                <div className="relative flex flex-col w-[329px] h-full">
                    <div className="absolute top-[14px] right-[16px]">
                        <span className="font-[var(--font-mono)] text-[10px] text-text-tertiary uppercase">
                            partner
                        </span>
                    </div>
                    <div className="flex justify-center items-center w-full h-full">
                        <PocketNameLogo />
                    </div>
                </div>
            </div>
        </div>
    );
}
