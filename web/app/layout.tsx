import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Fragment_Mono } from "next/font/google";
import "./globals.css";

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const fragment = Fragment_Mono({
  variable: "--font-fragment",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Hydra Arena", template: "%s · Hydra Arena" },
  description:
    "Hydra hides one bug in a working app. Kane CLI hunts it in a real browser. Your agent has to fix it from Kane's evidence alone.",
};

export const viewport: Viewport = {
  themeColor: "#0c0a09",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${instrument.variable} ${fragment.variable}`}>
      <body>{children}</body>
    </html>
  );
}
