
import "@/app/globals.css";
import {SessionProvider} from "next-auth/react";
import { rubik, overpass_mono } from "@/styles/fonts";
import WalletConnectionProvider from "@/app/context/WalletConnection/Provider";
import { ThemeProvider } from "@/app/theme";


export default function AuthLayout({
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
         attribute="class"
         defaultTheme="dark"
         enableSystem
         disableTransitionOnChange
       >
         <WalletConnectionProvider>
          <div className="flex flex-col items-center justify-center w-full h-dvh">
            {children}
          </div>
         </WalletConnectionProvider>
         </ThemeProvider>
       </SessionProvider>
     </body>
    </html>
   );
}
