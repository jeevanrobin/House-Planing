"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/supabase/use-user";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/#features", label: "Features" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader() {
  const user = useUser();
  const router = useRouter();
  const signOut = async () => {
    await supabase().auth.signOut();
    router.replace("/");
    router.refresh();
  };
  const initial = (user?.user_metadata?.full_name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow">
            <Compass className="size-5" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            AI Plot Planner
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/dashboard">Dashboard</Link>
              </Button>
              <span title={user.email ?? undefined} aria-label={`Signed in as ${user.email}`}
                className="flex size-9 items-center justify-center rounded-full border bg-accent font-display text-sm font-semibold text-accent-foreground">
                {initial}
              </span>
              <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
                <LogOut />
              </Button>
            </>
          ) : (
            <>
              {user === null && (
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link href="/login">Sign in</Link>
                </Button>
              )}
              <Button asChild size="sm">
                <Link href="/planner">Start free</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
