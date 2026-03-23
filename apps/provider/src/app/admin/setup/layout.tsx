import type {Metadata} from "next";
import {SessionProvider} from "next-auth/react";
import "@/app/globals.css";
import {ThemeProvider} from "@/app/theme";
import WalletConnectionProvider from "@/app/context/WalletConnection/Provider";
import {ApplicationSettingsProvider} from "@/app/context/ApplicationSettings";
import {SidebarInset, SidebarProvider} from "@igniter/ui/components/sidebar";
import {AppTopBar} from "@igniter/ui/components/AppTopBar/index";
import CurrentUser from "@/components/CurrentUser";
import Sidebar from "@/components/Sidebar";
import QueryClientProvider from "@/app/context/QueryClientProvider";
import NotificationsProvider from "@igniter/ui/context/Notifications/index";

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
              <SidebarProvider className="flex flex-col h-dvh overflow-hidden">
                <NotificationsProvider>
                  <AppTopBar>
                    <CurrentUser/>
                  </AppTopBar>
                  <div className="flex flex-1 min-h-0">
                    <Sidebar />
                    <SidebarInset className="!min-h-0">
                      <div className={"w-full h-full flex overflow-x-hidden"}>
                        <div className="flex flex-col w-full gap-6 flex-1 overflow-y-auto scrollbar-hidden md:w-[calc(100dvw-255px)]">{children}</div>
                      </div>
                    </SidebarInset>
                  </div>
                </NotificationsProvider>
              </SidebarProvider>
            </WalletConnectionProvider>
          </ApplicationSettingsProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
