"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Map, PencilRuler, Sparkles, Trash2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { deletePlan, getProject } from "@/lib/data/projects";
import { handoffFromPlot, writeHandoff } from "@/lib/data/handoff";

type Project = NonNullable<Awaited<ReturnType<typeof getProject>>>;

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = React.useState<Project | null | undefined>();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getProject(id).then(setProject).catch((e: Error) => setError(e.message));
  }, [id]);

  const newPlan = () => {
    writeHandoff(project?.plot ? handoffFromPlot(project.plot, id) : { projectId: id });
    router.push("/planner");
  };

  const remove = async (planId: string, name: string) => {
    if (!window.confirm(`Delete the plan "${name}"? This can't be undone.`)) return;
    try {
      await deletePlan(planId);
      setProject((p) => (p ? { ...p, plans: p.plans.filter((x) => x.id !== planId) } : p));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="min-h-dvh bg-grid">
      <SiteHeader />
      <main className="container py-8">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/dashboard"><ArrowLeft /> All projects</Link>
        </Button>
        {error && <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {project === undefined && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading project…</div>
        )}
        {project === null && <p className="text-sm text-muted-foreground">This project doesn&apos;t exist or isn&apos;t yours.</p>}
        {project && (
          <>
            <p className="label-mono">Project</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight">{project.name}</h1>
              <Button onClick={newPlan}><Sparkles /> Generate a plan</Button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
              <Card glass className="h-fit">
                <CardHeader><CardTitle className="flex items-center gap-2"><Map className="size-5" /> Plot</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {project.plot ? (
                    <>
                      <p className="font-mono text-xl font-semibold">{Math.round(project.plot.areaSqm * 10.764).toLocaleString("en-IN")} sq ft</p>
                      <p className="text-muted-foreground">
                        {project.plot.areaSqm.toFixed(0)} m² · {project.plot.facing}-facing · {project.plot.points.length} corners
                        {project.plot.city ? ` · ${project.plot.city}` : ""}
                      </p>
                      <Button asChild variant="outline" size="sm"><Link href={`/dashboard/projects/${id}/plot`}><PencilRuler /> Redraw plot</Link></Button>
                    </>
                  ) : (
                    <>
                      <p className="text-muted-foreground">No plot yet. Draw the land on the map so plans follow its real shape.</p>
                      <Button asChild size="sm"><Link href={`/dashboard/projects/${id}/plot`}><PencilRuler /> Draw plot</Link></Button>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Saved plans</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {project.plans.length === 0 && (
                    <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      No plans yet. Generate one, then use &ldquo;Save to project&rdquo; in the planner.
                    </p>
                  )}
                  {project.plans.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-secondary/40">
                      <Link href={`/planner?plan=${p.id}`} className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.builtUpSqm !== null ? `${Math.round(p.builtUpSqm * 10.764).toLocaleString("en-IN")} sq ft built-up · ` : ""}
                          Saved {new Date(p.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </Link>
                      {p.vastuScore !== null && <Badge>{p.vastuScore} Vastu</Badge>}
                      <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} onClick={() => remove(p.id, p.name)}><Trash2 /></Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
