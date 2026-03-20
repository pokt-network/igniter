import React, { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
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
}

export default function UserMenu({ user, children }: Readonly<UserMenuProps>) {
  const randomAvatar = getRandomInt(1, 4);
  const address = user.identity;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <div className="flex items-center gap-2 p-2 bg-bg-elevated border border-border-primary rounded-full hover:border-text-tertiary transition-colors">
          <AvatarByString string={address}  />
          {/*<UserAvatar address={address} selectedAvatar={randomAvatar} />*/}
          <span className="font-mono text-sm text-text-primary">
            {getShortAddress(address, 5)}
          </span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
