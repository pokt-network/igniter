import { SessionProvider } from "next-auth/react";
import "@/app/globals.css";
import { ThemeProvider } from "@/app/theme";
import WalletConnectionProvider from "@/app/context/WalletConnection/Provider";
import { ApplicationSettingsProvider } from "@/app/context/ApplicationSettings";
import { SidebarInset, SidebarProvider } from "@igniter/ui/components/sidebar";
import { AppTopBar } from "@igniter/ui/components/AppTopBar/index";
import PriceWidget from "@/components/PriceWidget";
import CurrentUser from "@/components/CurrentUser";
import { CurrencyContextProvider } from "@igniter/ui/context/currency";
import Sidebar from "@/components/Sidebar";
import QueryClientProvider from '@/app/context/QueryClientProvider'
import NotificationsProvider from '@igniter/ui/context/Notifications/index'
import RegisterPlugins from '@igniter/ui/components/RegisterChartjsPlugins'
import QuickDetailProvider from "@/app/admin/details/QuickDetailProviderBridge"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <QueryClientProvider>
      <SessionProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <ApplicationSettingsProvider>
            <WalletConnectionProvider>
              <CurrencyContextProvider>
                <SidebarProvider className="flex flex-col">
                  <QuickDetailProvider>
                    <NotificationsProvider>
                      <AppTopBar>
                        <PriceWidget />
                        <CurrentUser />
                      </AppTopBar>
                      <div className="flex flex-1">
                        <Sidebar />
                        <SidebarInset>
                          <div className={"w-full h-full flex overflow-x-hidden"}>
                            <div className="flex flex-col gap-6 w-[calc(100dvw)] md:w-[calc(100dvw-255px)]">
                              <RegisterPlugins />
                              {children}
                            </div>
                          </div>
                        </SidebarInset>
                      </div>
                    </NotificationsProvider>
                  </QuickDetailProvider>
                </SidebarProvider>
              </CurrencyContextProvider>
            </WalletConnectionProvider>
          </ApplicationSettingsProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
