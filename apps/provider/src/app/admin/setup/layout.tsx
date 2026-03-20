import type {Metadata} from "next";
import {SessionProvider} from "next-auth/react";
import "@/app/globals.css";
import {ThemeProvider} from "@/app/theme";
import WalletConnectionProvider from "@/app/context/WalletConnection/Provider";
import {ApplicationSettingsProvider} from "@/app/context/ApplicationSettings";
import {AppTopBar} from "@igniter/ui/components/AppTopBar/index";
import CurrentUser from "@/components/CurrentUser";
import QueryClientProvider from "@/app/context/QueryClientProvider";

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
              <AppTopBar>
                <CurrentUser/>
              </AppTopBar>
              <div className="flex flex-1">
                <div className={"w-full h-full flex overflow-x-hidden"}>
                  <div className="flex flex-col w-full gap-6">{children}</div>
                </div>
              </div>
            </WalletConnectionProvider>
          </ApplicationSettingsProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
