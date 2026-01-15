"use client";

import React from "react";
import {getCsrfToken, signIn, useSession, signOut} from "next-auth/react";
import Link from 'next/link';
import { usePathname } from "next/navigation";
import {SiwpMessage} from "@poktscan/vault-siwp";
import UserMenu from "@igniter/ui/components/UserMenu";
import {WalletPicker} from "@igniter/ui/components/WalletPicker/index";
import {useWalletConnection} from "@igniter/ui/context/WalletConnection/index";
import {useNotifications} from "@igniter/ui/context/Notifications/index";
import {useApplicationSettings} from "@/app/context/ApplicationSettings";
import {DropdownMenuItem, DropdownMenuSeparator} from "@igniter/ui/components/dropdown-menu";
import {Routes} from "@/lib/route-constants";
import {LoaderIcon} from "@igniter/ui/assets";

export default function CurrentUser() {
  const currentPath = usePathname();
  const { data, status } = useSession();
  const applicationSettings = useApplicationSettings();
  const { addNotification } = useNotifications();

  const {
    getChain,
    switchChain,
    clearConnectedIdentity
  } = useWalletConnection();

  const authenticateUser = async (
    message: SiwpMessage,
    signature: string,
    publicKey: string,
  ): Promise<void> => {
    try {
      if (status === 'loading') {
        return;
      }

      const chainOnWallet = await getChain();

      if (applicationSettings && (chainOnWallet !== applicationSettings?.chainId)) {
        await switchChain(applicationSettings?.chainId);
      }

      if (status === 'authenticated') {
        return;
      }

      await signIn("siwp", {
        message: JSON.stringify(message),
        signature,
        publicKey,
        redirectTo: '/app',
      });
    } catch (error) {
      if ((error as {message: string})?.message === "The user rejected the request.") {
        clearConnectedIdentity()
      } else {
        addNotification({
          id: 'sign-in-error',
          type: 'error',
          content: 'Sign-in failed. Please try again or clear your browser cache if the issue persists.',
        });
      }
      throw error;
    }
  };

  const isLanding = currentPath === Routes.root;
  const isAdmin = currentPath.startsWith(Routes.adminRoot);
  const isApp = currentPath.startsWith(Routes.appRoot);

  if (status === "loading") {
    return (
      <div
        className="flex items-center justify-center w-[150px] h-9 bg-[color:var(--secondary)] rounded-md opacity-50"
      >
        <LoaderIcon className="animate-spin" />
      </div>
    );
  }

  if (status === "authenticated") {
    return (
      <UserMenu user={data.user}>
        {!isLanding && (
          <Link href={Routes.root}>
            <DropdownMenuItem className="max-h-[38px]">
              <span>
                Go to portal
              </span>
            </DropdownMenuItem>
          </Link>
        )}
        {!isApp && (
          <Link href={Routes.appRoot}>
            <DropdownMenuItem className="max-h-[38px]">
              <span>
                Go to App
              </span>
            </DropdownMenuItem>
          </Link>
        )}
        {['owner', 'admin'].includes(data.user.role) && !isAdmin && (
          <Link href={Routes.adminRoot}>
            <DropdownMenuItem className="max-h-[38px]">
              <span>
                Go to Admin
              </span>
            </DropdownMenuItem>
          </Link>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()}>Sign out</DropdownMenuItem>
      </UserMenu>
    );
  }

  return (
    <WalletPicker
      onSignIn={authenticateUser}
      getCsrfToken={getCsrfToken}
    />
  );
}
