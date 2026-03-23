import type { ProviderInfoWithConnection } from '../../../context/WalletConnection'
import { ArrowBackIcon } from "@igniter/ui/assets";

export interface WalletPickerItemProps extends ProviderInfoWithConnection{
    onSelect?: (provider: ProviderInfoWithConnection) => void;
}

export default function WalletPickerItem({onSelect, ...providerInfo}: Readonly<WalletPickerItemProps>) {
    return (
        <div
          onClick={() => onSelect?.(providerInfo)}
          className="w-full h-[40px] flex flex-row items-center justify-between gap-2 rounded-lg bg-transparent transition-all duration-200 ease-in-out px-2 hover:bg-bg-hover cursor-pointer -ml-2 group"
        >
            <div className="flex gap-4 items-center">
                {providerInfo.icon && (
                  <img src={providerInfo.icon} alt={providerInfo.name} className="h-6 w-6" />
                )}
                <span className="text-[14px] text-text-primary">
                    {providerInfo.name}
                </span>
            </div>
            <ArrowBackIcon className="hidden group-hover:block rotate-180 transition-transform duration-200" />
        </div>
    );
}
