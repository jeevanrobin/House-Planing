import { centroidOf, toLocalMeters, type LatLng } from "@/lib/geo/plot-geometry";
import type { Facing, Requirements } from "@/lib/floorplan/types";

/** What the planner's requirements step is pre-filled with. */
export type PlotHandoff = Partial<Requirements> & { projectId?: string };

const KEY = "plotHandoff";

/** Plot → planner: dimensions, facing and the real outline (local metres, y north). */
export function handoffFromPlot(plot: { points: LatLng[]; widthM: number; lengthM: number; facing: Facing }, projectId?: string): PlotHandoff {
  const origin = centroidOf(plot.points);
  return {
    plotWidth: Math.max(3, Math.round(plot.widthM)),
    plotDepth: Math.max(3, Math.round(plot.lengthM)),
    facing: plot.facing,
    plotPolygon: plot.points.length >= 3 ? toLocalMeters(plot.points, origin).map((v) => [v.x, v.y] as [number, number]) : undefined,
    projectId,
  };
}

export function writeHandoff(h: PlotHandoff) {
  window.sessionStorage.setItem(KEY, JSON.stringify(h));
}

export function readHandoff(): PlotHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlotHandoff) : null;
  } catch {
    return null;
  }
}
