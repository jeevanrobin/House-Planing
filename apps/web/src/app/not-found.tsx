import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-dvh bg-grid">
      <SiteHeader />
      <main className="container flex flex-col items-start py-24">
        <p className="label-mono">404 · Off the plot</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">This page isn&apos;t on the drawing.</h1>
        <p className="mt-3 max-w-lg text-muted-foreground">
          The link may be old, or the plan may belong to another account.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild><Link href="/planner">Plan a house</Link></Button>
          <Button asChild variant="outline"><Link href="/dashboard">Your projects</Link></Button>
        </div>
      </main>
    </div>
  );
}
