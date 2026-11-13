import React, { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@igniter/ui/components/dropdown-menu";
import { getRandomInt, getShortAddress } from "@igniter/ui/lib/utils";
import AvatarByString from './AvatarByString'

export interface UserMenuProps {
  user: {
    identity: string;
    role: string;
  };
  children: ReactNode;
  /** Address the app currently acts as. Falls back to the signed-in identity. */
  activeAddress?: string;
  /** Every address the wallet exposes. A picker renders when more than one. */
  addresses?: string[];
  onSelectAddress?: (address: string) => void;
}

export default function UserMenu({ user, children, activeAddress, addresses, onSelectAddress }: Readonly<UserMenuProps>) {
  const randomAvatar = getRandomInt(1, 4);
  const address = activeAddress ?? user.identity;
  const showPicker = Boolean(onSelectAddress) && (addresses?.length ?? 0) > 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full hover:border-text-tertiary">
        <div className="flex items-center gap-2 px-3 py-2">
          <AvatarByString string={address} />
          <span className="font-mono text-sm text-text-primary">
            {getShortAddress(address, 5)}
          </span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {showPicker && (
          <>
            <DropdownMenuLabel className="text-xs text-text-secondary">Active address</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={address} onValueChange={onSelectAddress}>
              {addresses!.map((a) => (
                <DropdownMenuRadioItem key={a} value={a} className="font-mono text-xs">
                  {getShortAddress(a, 5)}
                  {a === user.identity && <span className="ml-2 font-sans text-text-tertiary">signed in</span>}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
