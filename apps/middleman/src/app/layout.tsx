import { Jost, Overpass_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import "@/app/globals.css";
import { ThemeProvider } from "@/app/theme";
import WalletConnectionProvider from "@/app/context/WalletConnection/Provider";
import { ApplicationSettingsProvider } from "@/app/context/ApplicationSettings";
import { SidebarInset, SidebarProvider } from "@igniter/ui/components/sidebar";
import { AppTopBar } from "@igniter/ui/components/AppTopBar/index";
import PriceWidget from "@/app/components/PriceWidget";
import CurrentUser from "@/app/components/CurrentUser";
import { CurrencyContextProvider } from "@igniter/ui/context/currency";
import Sidebar from "@/app/components/Sidebar";
import { Toaster } from "@igniter/ui/components/sonner";
import QueryClientProvider from '@/app/context/QueryClientProvider';
import RegisterPlugins from '@igniter/ui/components/RegisterChartjsPlugins';
import NotificationsProvider from '@igniter/ui/context/Notifications/index';
import QuickDetailProvider from "@/app/detail/QuickDetailProviderBridge";

const jost = Jost({
  variable: "--font-jost",
  weight: ["400", "600", "500", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
});

const overpass_mono = Overpass_Mono({
  variable: "--font-overpass-mono",
  weight: ["400", "600", "500", "700"],
  style: ["normal"],
  subsets: ["latin"],
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${overpass_mono.variable} ${jost.variable} overflow-hidden`}
      suppressHydrationWarning
    >
      <body>
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
                            <SidebarInset className={'transition-none'}>
                              <div className={"w-full h-full flex overflow-x-hidden"}>
                                <div className="flex flex-col gap-6 h-[calc(100vh-72px)] overflow-y-scroll scrollbar-hidden w-[calc(100dvw)] md:w-[calc(100dvw-255px)] transition-none">
                                  <RegisterPlugins />
                                  {children}
                                  <Toaster />
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
      </body>
    </html>
  );
}
