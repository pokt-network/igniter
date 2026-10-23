import { rubik, overpass_mono } from "@/styles/fonts"

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
      <body>{children}</body>
    </html>
  );
}
