"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { PlotSelector } from "@/components/plot/plot-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasApi } from "@/lib/api/client";
import { createPlot, type PlotPayload } from "@/lib/api/plots";
import type { LatLng } from "@/lib/geo/plot-geometry";

const lsKey = (pid: string) => `plot:${pid}`;

export default function PlotDetailsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [initial, setInitial] = React.useState<LatLng[] | undefined>();
  const [loaded, setLoaded] = React.useState(false);

  // Load a previously saved plot (localStorage in this scaffold).
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(lsKey(projectId));
      if (raw) setInitial(JSON.parse(raw).points as LatLng[]);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, [projectId]);

  const handleSave = async (payload: PlotPayload) => {
    // Persist locally so the plot reloads and can hand off to the planner.
    window.localStorage.setItem(
      lsKey(projectId),
      JSON.stringify({ points: payload.points, facing: payload.facing }),
    );
    window.sessionStorage.setItem(
      "plotHandoff",
      JSON.stringify({
        plotWidth: Math.round(payload.width_m),
        plotDepth: Math.round(payload.length_m),
        facing: payload.facing,
      }),
    );
    // If a backend + auth token are configured, also persist server-side.
    if (hasApi && window.localStorage.getItem("app.accessToken")) {
      await createPlot(payload);
    }
  };

  return (
    <div className="min-h-dvh bg-grid">
      <SiteHeader />
      <main className="container py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
              <Link href="/dashboard"><ArrowLeft /> Back to projects</Link>
            </Button>
            <h1 className="font-display text-2xl font-bold tracking-tight">Select your plot</h1>
            <p className="text-sm text-muted-foreground">
              Draw the land boundary on the map to calculate area, dimensions and orientation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="muted">Project {projectId.slice(0, 8)}</Badge>
            <Button asChild variant="outline" size="sm">
              <Link href="/planner"><Sparkles /> Continue to planner</Link>
            </Button>
          </div>
        </div>

        {loaded && (
          <PlotSelector projectId={projectId} initialPoints={initial} onSave={handleSave} />
        )}
      </main>
    </div>
  );
}
