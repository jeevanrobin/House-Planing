"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, FolderPlus, Loader2, Map, Trash2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createProject, deleteProject, listProjects, unlockedProjects, type ProjectSummary } from "@/lib/data/projects";
import { useUser } from "@/lib/supabase/use-user";
import { UnlockButton } from "@/components/billing/unlock-button";

export default function Dashboard() {
  const user = useUser();
  const router = useRouter();
  const [projects, setProjects] = React.useState<ProjectSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [pro, setPro] = React.useState<Set<string>>(new Set());

  const load = React.useCallback(() => {
    listProjects().then(setProjects).catch((e: Error) => setError(e.message));
    unlockedProjects().then(setPro).catch(() => setPro(new Set()));
  }, []);
  const freeUsed = projects ? projects.filter((p) => !pro.has(p.id)).length : 0;
  React.useEffect(() => { if (user) load(); }, [user, load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const id = await createProject(name);
      router.push(`/dashboard/projects/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  };

  const remove = async (p: ProjectSummary) => {
    if (!window.confirm(`Delete "${p.name}" and its ${p.planCount} saved plan(s)? This can't be undone.`)) return;
    try {
      await deleteProject(p.id);
      setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const first = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0];
  const plans = projects?.reduce((a, p) => a + p.planCount, 0) ?? 0;
  const vastu = projects?.map((p) => p.latestVastu).filter((v): v is number => v !== null) ?? [];

  return (
    <div className="min-h-dvh bg-grid">
      <SiteHeader />
      <main className="container py-8">
        <p className="label-mono">Dashboard</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">{first ? `Hello, ${first}` : "Your projects"}</h1>
        <p className="text-sm text-muted-foreground">Each project holds a plot and the plans you generate for it.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Projects" value={projects ? String(projects.length) : "–"} />
          <Stat label="Saved plans" value={projects ? String(plans) : "–"} />
          <Stat label="Average Vastu (latest plans)" value={vastu.length ? String(Math.round(vastu.reduce((a, b) => a + b, 0) / vastu.length)) : "–"} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle>Projects</CardTitle>
              <form onSubmit={create} className="flex w-full max-w-sm gap-2">
                <label htmlFor="new-project" className="sr-only">New project name</label>
                <input id="new-project" value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
                  placeholder="New project, e.g. Whitefield villa"
                  className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" />
                <Button type="submit" size="sm" disabled={creating || !name.trim()}>
                  {creating ? <Loader2 className="animate-spin" /> : <FolderPlus />} Create
                </Button>
              </form>
            </CardHeader>
            <CardContent className="space-y-2">
              {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
              {!projects && !error && (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading projects…</div>
              )}
              {projects?.length === 0 && (
                <div className="rounded-md border border-dashed p-8 text-center">
                  <Compass className="mx-auto size-8 text-muted-foreground" />
                  <p className="mt-3 font-medium">No projects yet</p>
                  <p className="text-sm text-muted-foreground">Create a project above, draw your plot on the map, then generate plans for it.</p>
                </div>
              )}
              {projects?.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-secondary/40">
                  <Link href={`/dashboard/projects/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Map className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 truncate font-medium">
                        {p.name}
                        {pro.has(p.id) && <span className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-accent-foreground">Pro</span>}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {p.plot ? `${Math.round(p.plot.areaSqm * 10.764).toLocaleString("en-IN")} sq ft · ${p.plot.facing}-facing` : "No plot yet"}
                        {" · "}{p.planCount} plan{p.planCount === 1 ? "" : "s"} · Updated {relative(p.updatedAt)}
                      </span>
                    </span>
                  </Link>
                  {p.latestVastu !== null && <Badge>{p.latestVastu} Vastu</Badge>}
                  {!pro.has(p.id) && <UnlockButton projectId={p.id} onUnlocked={load} />}
                  <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card glass className="h-fit">
            <CardHeader><CardTitle>Plan</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-display text-xl font-bold">Free</p>
              <p className="text-muted-foreground">
                {Math.min(freeUsed, 3)} of 3 free projects used. Unlimited plans in each.
              </p>
              <p className="text-muted-foreground">
                <b className="text-foreground">Pro · ₹499 per project</b>, once: the PDF drawing set, colour plan, front elevation and
                plumbing &amp; drainage sheet. Use <b className="text-foreground">Unlock Pro</b> on a project.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card glass>
      <CardContent className="pt-6">
        <div className="font-mono text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function relative(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
