import type { Facing } from "@/lib/floorplan/types";
import type { LatLng } from "@/lib/geo/plot-geometry";
import { toGeoJSON } from "@/lib/geo/plot-geometry";
import { api } from "./client";

export interface PlotPayload {
  project_id: string;
  points: LatLng[];
  area_sqft: number;
  area_sqm: number;
  perimeter_m: number;
  length_m: number;
  width_m: number;
  facing: Facing;
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface PlotRecord extends Omit<PlotPayload, "points"> {
  id: string;
  boundary: ReturnType<typeof toGeoJSON>;
  created_at: string;
}

export function createPlot(payload: PlotPayload): Promise<PlotRecord> {
  const { points, ...rest } = payload;
  return api<PlotRecord>(`/plots`, {
    method: "POST",
    body: JSON.stringify({ ...rest, boundary: toGeoJSON(points) }),
  });
}

export function listPlots(projectId: string): Promise<PlotRecord[]> {
  return api<PlotRecord[]>(`/projects/${projectId}/plots`);
}

export function getPlot(id: string): Promise<PlotRecord> {
  return api<PlotRecord>(`/plots/${id}`);
}

export function deletePlot(id: string): Promise<void> {
  return api<void>(`/plots/${id}`, { method: "DELETE" });
}
