import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Sora({
  subsets: ["latin"],
  variable: "--font-display",
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
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#070b14" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
