import type {Metadata} from "next";
import {SessionProvider} from "next-auth/react";
import "@/app/globals.css";
import {ThemeProvider} from "@/app/theme";
import WalletConnectionProvider from "@/app/context/WalletConnection/Provider";
import {ApplicationSettingsProvider} from "@/app/context/ApplicationSettings";
import {AppTopBar} from "@igniter/ui/components/AppTopBar/index";
import CurrentUser from "@/components/CurrentUser";
import QueryClientProvider from "@igniter/ui/context/QueryClientProvider";
import { Toaster } from "@igniter/ui/components/sonner";

export const metadata: Metadata = {
  title: "Stake Igniter",
  description: "Light up your earnings with Igniter",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <QueryClientProvider>
      <SessionProvider>
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <ApplicationSettingsProvider>
            <WalletConnectionProvider>
              <div className="flex flex-col h-dvh overflow-hidden">
                <AppTopBar>
                  <CurrentUser/>
                </AppTopBar>
                <div className="flex-1 overflow-y-auto p-6">
                  {children}
                </div>
                <Toaster />
              </div>
            </WalletConnectionProvider>
          </ApplicationSettingsProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
