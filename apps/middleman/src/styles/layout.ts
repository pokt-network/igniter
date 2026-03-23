import type {Metadata} from "next";
import {Rubik, Overpass_Mono} from "next/font/google";

export const rubik = Rubik({
    variable: "--font-rubik",
    weight: ["300", "400", "500", "600", "700"],
    style: ["normal", "italic"],
    subsets: ["latin"],
    display: "swap",
});

export const overpass_mono = Overpass_Mono({
    variable: "--font-overpass-mono",
    weight: ["400", "600", "500", "700"],
    style: ["normal"],
    subsets: ["latin"],
    display: "swap",
});
