import localFont from "next/font/local";

// Self-hosted (latin subset, variable weight) so `next build` never fetches from Google Fonts:
// that fetch failed CI and docker builds at random. Files and OFL licenses are in ./fonts.
export const rubik = localFont({
  variable: "--font-rubik",
  src: [
    { path: "./fonts/Rubik-latin.woff2", weight: "300 700", style: "normal" },
    { path: "./fonts/Rubik-Italic-latin.woff2", weight: "300 700", style: "italic" },
  ],
  display: "swap",
});

export const overpass_mono = localFont({
  variable: "--font-overpass-mono",
  src: [{ path: "./fonts/OverpassMono-latin.woff2", weight: "400 700", style: "normal" }],
  display: "swap",
});
