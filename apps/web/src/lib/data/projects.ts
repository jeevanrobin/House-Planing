"use client";

/**
 * Projects, plots and saved plans in Supabase. Row-level security on every
 * table (supabase/migrations/0001_init.sql) guarantees users only ever reach
 * their own rows, so the browser can query these tables directly.
 */
import { supabase } from "@/lib/supabase/client";
import { toGeoJSON, type LatLng } from "@/lib/geo/plot-geometry";
import type { Facing, PlanResult, Requirements } from "@/lib/floorplan/types";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  planCount: number;
  /** Most recent plot's area / facing, if a plot has been drawn. */
  plot: { areaSqm: number; facing: Facing } | null;
  /** Vastu score of the most recent saved plan. */
  latestVastu: number | null;
}

export interface PlanSummary {
  id: string;
  name: string;
  vastuScore: number | null;
  builtUpSqm: number | null;
  createdAt: string;
}

export interface SavedPlan extends PlanSummary {
  projectId: string;
  requirements: Requirements;
  plan: PlanResult;
}

export interface PlotInput {
  points: LatLng[];
  areaSqm: number;
  perimeterM: number;
  lengthM: number;
  widthM: number;
  facing: Facing;
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}

export interface SavedPlot extends Omit<PlotInput, "points"> {
  id: string;
  points: LatLng[];
  createdAt: string;
}

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const { data, error } = await supabase()
    .from("projects")
    .select("id, name, description, updated_at, plans(count), latest_plan:plans(vastu_score, created_at), latest_plot:plots(area_sqm, facing, created_at)")
    .order("updated_at", { ascending: false })
    .order("created_at", { referencedTable: "latest_plan", ascending: false })
    .limit(1, { referencedTable: "latest_plan" })
    .order("created_at", { referencedTable: "latest_plot", ascending: false })
    .limit(1, { referencedTable: "latest_plot" });
  fail(error);
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    updatedAt: p.updated_at,
    planCount: (p.plans as unknown as { count: number }[])[0]?.count ?? 0,
    plot: p.latest_plot?.[0] ? { areaSqm: Number(p.latest_plot[0].area_sqm), facing: p.latest_plot[0].facing as Facing } : null,
    latestVastu: p.latest_plan?.[0]?.vastu_score ?? null,
  }));
}

export async function createProject(name: string, description?: string): Promise<string> {
  const { data, error } = await supabase()
    .from("projects")
    .insert({ name: name.trim(), description: description?.trim() || null })
    .select("id")
    .single();
  fail(error);
  return data!.id as string;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const { error } = await supabase().from("projects").update({ name: name.trim() }).eq("id", id);
  fail(error);
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase().from("projects").delete().eq("id", id);
  fail(error);
}

export async function getProject(id: string): Promise<{ id: string; name: string; plans: PlanSummary[]; plot: SavedPlot | null } | null> {
  const sb = supabase();
  const [project, plans, plot] = await Promise.all([
    sb.from("projects").select("id, name").eq("id", id).maybeSingle(),
    sb.from("plans").select("id, name, vastu_score, built_up_sqm, created_at").eq("project_id", id).order("created_at", { ascending: false }),
    latestPlot(id),
  ]);
  fail(project.error);
  fail(plans.error);
  if (!project.data) return null;
  return {
    id: project.data.id,
    name: project.data.name,
    plot,
    plans: (plans.data ?? []).map((p) => ({
      id: p.id, name: p.name, vastuScore: p.vastu_score,
      builtUpSqm: p.built_up_sqm === null ? null : Number(p.built_up_sqm), createdAt: p.created_at,
    })),
  };
}

export async function savePlot(projectId: string, plot: PlotInput): Promise<void> {
  const { error } = await supabase().from("plots").insert({
    project_id: projectId,
    boundary: toGeoJSON(plot.points),
    area_sqm: round(plot.areaSqm),
    perimeter_m: round(plot.perimeterM),
    length_m: round(plot.lengthM),
    width_m: round(plot.widthM),
    facing: plot.facing,
    latitude: plot.latitude,
    longitude: plot.longitude,
    address: plot.address ?? null,
    city: plot.city ?? null,
    state: plot.state ?? null,
    country: plot.country ?? null,
  });
  fail(error);
}

export async function latestPlot(projectId: string): Promise<SavedPlot | null> {
  const { data, error } = await supabase()
    .from("plots")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(error);
  if (!data) return null;
  const ring = (data.boundary?.coordinates?.[0] ?? []) as [number, number][];
  return {
    id: data.id,
    // GeoJSON rings repeat the first point at the end.
    points: ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng })),
    areaSqm: Number(data.area_sqm),
    perimeterM: Number(data.perimeter_m),
    lengthM: Number(data.length_m),
    widthM: Number(data.width_m),
    facing: data.facing,
    latitude: data.latitude,
    longitude: data.longitude,
    address: data.address ?? undefined,
    city: data.city ?? undefined,
    state: data.state ?? undefined,
    country: data.country ?? undefined,
    createdAt: data.created_at,
  };
}

export async function savePlan(projectId: string, name: string, requirements: Requirements, plan: PlanResult, vastuScore: number): Promise<string> {
  const builtUp = plan.floors.reduce((a, f) => a + f.metrics.builtUpArea, 0);
  const { data, error } = await supabase()
    .from("plans")
    .insert({
      project_id: projectId,
      name: name.trim(),
      requirements,
      plan,
      vastu_score: Math.round(vastuScore),
      built_up_sqm: round(builtUp),
    })
    .select("id")
    .single();
  fail(error);
  return data!.id as string;
}

export async function getPlan(id: string): Promise<SavedPlan | null> {
  const { data, error } = await supabase().from("plans").select("*").eq("id", id).maybeSingle();
  fail(error);
  if (!data) return null;
  return {
    id: data.id, projectId: data.project_id, name: data.name, vastuScore: data.vastu_score,
    builtUpSqm: data.built_up_sqm === null ? null : Number(data.built_up_sqm), createdAt: data.created_at,
    requirements: data.requirements, plan: data.plan,
  };
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await supabase().from("plans").delete().eq("id", id);
  fail(error);
}

const round = (n: number) => Math.round(n * 100) / 100;
