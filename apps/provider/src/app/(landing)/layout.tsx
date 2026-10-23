import { rubik, overpass_mono } from "@/styles/fonts";
import { SessionProvider } from "next-auth/react";
import "@/app/globals.css";
import { ThemeProvider } from "@/app/theme";
import WalletConnectionProvider from "@/app/context/WalletConnection/Provider";
import {ApplicationSettingsProvider} from "@/app/context/ApplicationSettings";
import { Toaster } from "@igniter/ui/components/sonner";


export default function RootLayout({
                                     children,
                                   }: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${overpass_mono.variable} ${rubik.variable} overflow-x-hidden`}
      suppressHydrationWarning
    >
    <body>
    <SessionProvider>
      <ThemeProvider
        attribute="data-theme"
        defaultTheme="dark"
        enableSystem={false}
        disableTransitionOnChange
      >
        <ApplicationSettingsProvider>
          <WalletConnectionProvider>
            <div className="flex flex-col items-center justify-center w-full h-dvh">
              {children}
            </div>
            <Toaster />
          </WalletConnectionProvider>
        </ApplicationSettingsProvider>
      </ThemeProvider>
    </SessionProvider>
    </body>
    </html>
  );
}
