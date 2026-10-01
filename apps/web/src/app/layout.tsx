import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Wide drafting lettering for headings, an engineering sans for text,
// and a mono for dimensions and figures.
const display = Archivo({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["wdth"],
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://aiplotplanner.com"),
  title: {
    default: "AI Plot Planner — Design your home from a map",
    template: "%s · AI Plot Planner",
  },
  description:
    "Select your plot on the map, and let AI generate intelligent, Vastu-aware 2D house plans in seconds. Built for homeowners, architects and builders.",
  keywords: [
    "house plan generator",
    "AI floor plan",
    "plot area calculator",
    "2D house design",
    "Vastu home design",
  ],
  openGraph: {
    title: "AI Plot Planner",
    description: "AI-generated 2D house plans from a map-selected plot.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0f2240" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
