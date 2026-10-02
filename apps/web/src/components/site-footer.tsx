import Link from "next/link";
import { Compass } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="container flex flex-col gap-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Compass className="size-4" />
          </span>
          <span className="font-display font-semibold text-foreground">AI Plot Planner</span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
          <Link href="/planner" className="hover:text-foreground">Planner</Link>
          <Link href="/#how" className="hover:text-foreground">How it works</Link>
          <Link href="/#pricing" className="hover:text-foreground">Pricing</Link>
          <Link href="/#faq" className="hover:text-foreground">FAQ</Link>
          <Link href="/dashboard" className="hover:text-foreground">Your projects</Link>
        </nav>
        <p className="text-xs">Plans are concept designs — have them reviewed by a licensed professional before building.</p>
      </div>
    </footer>
  );
}
