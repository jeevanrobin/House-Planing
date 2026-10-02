"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { PlotSelector } from "@/components/plot/plot-selector";
import { Button } from "@/components/ui/button";
import { latestPlot, savePlot, type PlotInput } from "@/lib/data/projects";
import { handoffFromPlot, writeHandoff } from "@/lib/data/handoff";
import type { LatLng } from "@/lib/geo/plot-geometry";

export default function PlotDetailsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const router = useRouter();
  const [initial, setInitial] = React.useState<LatLng[] | undefined>();
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Open on the project's saved plot, if there is one.
  React.useEffect(() => {
    latestPlot(projectId)
      .then((p) => setInitial(p?.points))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [projectId]);

  const handleSave = async (plot: PlotInput) => {
    await savePlot(projectId, plot);
    // Hand the real outline forward so the planner follows the plot's shape.
    writeHandoff(handoffFromPlot(plot, projectId));
  };

  return (
    <div className="min-h-dvh bg-grid">
      <SiteHeader />
      <main className="container py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
              <Link href={`/dashboard/projects/${projectId}`}><ArrowLeft /> Back to project</Link>
            </Button>
            <h1 className="font-display text-2xl font-bold tracking-tight">Draw your plot</h1>
            <p className="text-sm text-muted-foreground">
              Trace the land boundary on the map. Save it, then generate plans that follow its shape.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push("/planner")}>Continue to planner</Button>
        </div>

        {error && <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {!loaded ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading plot…</div>
        ) : (
          <PlotSelector initialPoints={initial} onSave={handleSave} />
        )}
      </main>
    </div>
  );
}
