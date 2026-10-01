"use client";

import Link from "next/link";
import {
  Plus, FolderKanban, Sparkles, TrendingUp, Crown, MoreVertical, Map,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PROJECTS = [
  { id: "whitefield-villa", name: "Whitefield Villa", area: "216 m²", floors: 2, vastu: 82, updated: "2 days ago" },
  { id: "rajajinagar-duplex", name: "Rajaji Nagar Duplex", area: "148 m²", floors: 2, vastu: 76, updated: "5 days ago" },
  { id: "beachfront-bungalow", name: "Beachfront Bungalow", area: "320 m²", floors: 1, vastu: 91, updated: "1 week ago" },
];

const STATS = [
  { label: "Projects", value: "3 / 3", icon: FolderKanban, hint: "Free plan limit" },
  { label: "Plans generated", value: "27", icon: Sparkles },
  { label: "Avg. Vastu score", value: "83", icon: TrendingUp },
];

export default function Dashboard() {
  return (
    <div className="min-h-dvh bg-grid">
      <SiteHeader />
      <main className="container py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">Welcome back 👋</h1>
            <p className="text-sm text-muted-foreground">Here&apos;s an overview of your projects.</p>
          </div>
          <Button asChild>
            <Link href="/planner"><Plus /> New project</Link>
          </Button>
        </div>

        {/* Stats */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {STATS.map((s) => (
            <Card key={s.label} glass>
              <CardContent className="flex items-center gap-4 pt-6">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </span>
                <div>
                  <div className="font-display text-2xl font-bold">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}{s.hint ? ` · ${s.hint}` : ""}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          {/* Projects */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Projects</CardTitle>
              <Badge variant="muted">{PROJECTS.length} active</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {PROJECTS.map((p) => (
                <Link key={p.id} href={`/dashboard/projects/${p.id}/plot`}
                  className="flex items-center justify-between rounded-xl border p-3 transition-colors hover:bg-secondary/40">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Map className="size-5" />
                    </span>
                    <div>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.area} · {p.floors} floors · Updated {p.updated}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge>{p.vastu} Vastu</Badge>
                    <span className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary"><MoreVertical className="size-4" /></span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Subscription */}
          <Card glass className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Crown className="size-5 text-amber-500" /> Subscription</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm text-muted-foreground">Current plan</div>
                <div className="font-display text-xl font-bold">Free</div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Project usage</span><span>3 / 3</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-full rounded-full bg-gradient-to-r from-primary to-accent" />
                </div>
              </div>
              <Button className="w-full">Upgrade to Pro</Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
