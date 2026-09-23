"use client";

import React from "react";
import {getCsrfToken, signIn, useSession, signOut} from "next-auth/react";

import { usePathname } from "next/navigation";
import {SiwpMessage} from "@poktscan/vault-siwp";
import UserMenu from "@igniter/ui/components/UserMenu";
import {WalletPicker} from "@igniter/ui/components/WalletPicker/index";
import {useWalletConnection} from "@igniter/ui/context/WalletConnection/index";
import { toast } from "@igniter/ui/components/sonner";
import {useApplicationSettings} from "@/app/context/ApplicationSettings";
import {DropdownMenuItem, DropdownMenuSeparator} from "@igniter/ui/components/dropdown-menu";
import {Routes} from "@/lib/route-constants";
import {LoaderIcon} from "@igniter/ui/assets";

export default function CurrentUser() {
  const currentPath = usePathname();
  const { data, status } = useSession();
  const applicationSettings = useApplicationSettings();
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

      // Use redirect: false so we can do a hard navigation via
      // window.location.  A soft (client-side) redirect would keep the
      // landing-page layout mounted and the sidebar would not appear.
      const result = await signIn("siwp", {
        message: JSON.stringify(message),
        signature,
        publicKey,
        redirect: false,
      });

      if (result?.ok) {
        window.location.href = '/app';
        return;
      }
    } catch (error) {
      if ((error as {message: string})?.message === "The user rejected the request.") {
        clearConnectedIdentity()
      } else {
        toast.error('Sign-in failed. Please try again or clear your browser cache if the issue persists.', { id: 'sign-in-error' });
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
        className="flex items-center justify-center w-[150px] h-9 bg-bg-elevated border border-border-primary rounded-full opacity-50"
      >
        <LoaderIcon className="animate-spin" />
      </div>
    );
  }

  if (status === "authenticated") {
    return (
      <UserMenu user={data.user}>
        {!isLanding && (
          <a href={Routes.root}>
            <DropdownMenuItem className="max-h-[38px]">
              <span>
                Go to portal
              </span>
            </DropdownMenuItem>
          </a>
        )}
        {!isApp && (
          <a href={Routes.appRoot}>
            <DropdownMenuItem className="max-h-[38px]">
              <span>
                Go to App
              </span>
            </DropdownMenuItem>
          </a>
        )}
        {['owner', 'admin'].includes(data.user.role) && !isAdmin && (
          <a href={Routes.adminRoot}>
            <DropdownMenuItem className="max-h-[38px]">
              <span>
                Go to Admin
              </span>
            </DropdownMenuItem>
          </a>
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
