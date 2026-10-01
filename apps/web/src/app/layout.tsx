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
    default: "AI Plot Planner — house plans that fit your plot",
    template: "%s · AI Plot Planner",
  },
  description:
    "Draw your plot on the map, describe your home, and get a furnished, dimensioned, Vastu-scored house plan that follows your land's real shape — with a site plan, a 3D model and a PDF drawing set.",
  keywords: ["house plan generator", "floor plan from plot", "Vastu house plan", "3D house model", "irregular plot house design"],
  openGraph: {
    title: "AI Plot Planner",
    description: "House plans that fit your plot — drawn like an architect's sheet, in under a second.",
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
