import React from 'react'
import { cookies } from 'next/headers'
import { PROVIDER_COOKIE_KEY } from '@igniter/ui/context/WalletConnection/constants'
import { GetApplicationSettings } from '@/actions/ApplicationSettings'
import ClientWalletConnectionProvider from './client'
import { auth } from '@/auth'

export default async function WalletConnectionProvider({children}: React.PropsWithChildren) {
  const [
    session,
    cookiesAwaited,
    appSettings,
  ] = await Promise.all([
    auth(),
    cookies(),
    GetApplicationSettings()
  ]);

  return (
    <ClientWalletConnectionProvider
      expectedConnection={{
        identity: session?.user?.identity,
        provider: cookiesAwaited.get(PROVIDER_COOKIE_KEY)?.value,
      }}
      settings={{
        apiUrl: '/api/rpc',
        chainId: appSettings.chainId
      }}
    >
      {children}
    </ClientWalletConnectionProvider>
  )
}
