import { Rubik, Overpass_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import "@/app/globals.css";
import { ThemeProvider } from "@/app/theme";
import WalletConnectionProvider from "@/app/context/WalletConnection/Provider";
import {ApplicationSettingsProvider} from "@/app/context/ApplicationSettings";
import NotificationsProvider from "@igniter/ui/context/Notifications/index";

const rubik = Rubik({
  variable: "--font-rubik",
  weight: ["300", "400", "500", "600", "700"],
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
            <NotificationsProvider>
              <div className="flex flex-col items-center justify-center w-full h-dvh">
                {children}
              </div>
            </NotificationsProvider>
          </WalletConnectionProvider>
        </ApplicationSettingsProvider>
      </ThemeProvider>
    </SessionProvider>
    </body>
    </html>
  );
}
