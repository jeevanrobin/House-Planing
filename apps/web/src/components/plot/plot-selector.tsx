"use client";

import * as React from "react";
import { PencilRuler, Trash2, Save, AlertTriangle, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { PlotMap, type PlotMapHandle } from "@/components/plot/plot-map";
import { PlotMapFallback } from "@/components/plot/plot-map-fallback";
import { PlotInfoCard } from "@/components/plot/plot-info-card";
import { Button } from "@/components/ui/button";
import { hasMapsKey } from "@/lib/maps/loader";
import { reverseGeocode, type PlotAddress } from "@/lib/maps/geocode";
import {
  computePlotMetrics, validatePolygon, toLocalMeters, centroidOf,
  type LatLng, type PlotMetrics,
} from "@/lib/geo/plot-geometry";
import type { Facing, Polygon } from "@/lib/floorplan/types";
import type { PlotInput } from "@/lib/data/projects";

interface Props {
  initialPoints?: LatLng[];
  onSave?: (plot: PlotInput) => Promise<void>;
  /** Planner flow: hand the plot's dimensions forward to the wizard. */
  onContinue?: (dims: { plotWidth: number; plotDepth: number; facing: Facing; plotPolygon?: Polygon }) => void;
  continueLabel?: string;
}

export function PlotSelector({
  initialPoints,
  onSave,
  onContinue,
  continueLabel = "Use this plot",
}: Props) {
  const mapRef = React.useRef<PlotMapHandle>(null);
  const [points, setPoints] = React.useState<LatLng[]>(initialPoints ?? []);
  const [reload, setReload] = React.useState(0);
  const [address, setAddress] = React.useState<PlotAddress | null>(null);
  const [facing, setFacing] = React.useState<Facing>("N");
  const [facingTouched, setFacingTouched] = React.useState(false);
  const [mapError, setMapError] = React.useState<string | null>(null);
  const [mapFailed, setMapFailed] = React.useState(false);
  const [save, setSave] = React.useState<{ state: "idle" | "saving" | "saved" | "error"; msg?: string }>({ state: "idle" });

  const metrics: PlotMetrics | null = React.useMemo(
    () => (points.length >= 3 ? computePlotMetrics(points) : null),
    [points],
  );
  const validation = points.length ? validatePolygon(points) : { ok: false };

  // Auto-facing follows the geometry until the user overrides it.
  React.useEffect(() => {
    if (metrics && !facingTouched) setFacing(metrics.facing);
  }, [metrics, facingTouched]);

  // Debounced reverse-geocode (only when the real map/key is present).
  React.useEffect(() => {
    if (!metrics || !hasMapsKey) return;
    const id = setTimeout(() => {
      reverseGeocode(metrics.centroid).then(setAddress).catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [metrics]);

  const handleChange = React.useCallback((pts: LatLng[]) => {
    setPoints(pts);
    setSave({ state: "idle" });
  }, []);

  const handleContinue = () => {
    if (!metrics || !validation.ok || !onContinue) return;
    // Convert lat/lng points to local-metre polygon for the engine.
    let plotPolygon: Polygon | undefined;
    if (points.length >= 3) {
      const origin = centroidOf(points);
      const local = toLocalMeters(points, origin);
      plotPolygon = local.map((v) => [v.x, v.y] as [number, number]);
    }
    onContinue({
      plotWidth: Math.max(3, Math.round(metrics.widthM)),
      plotDepth: Math.max(3, Math.round(metrics.lengthM)),
      facing,
      plotPolygon,
    });
  };

  const doSave = async () => {
    if (!onSave || !metrics || !validation.ok) return;
    setSave({ state: "saving" });
    try {
      await onSave({
        points,
        areaSqm: metrics.areaSqm,
        perimeterM: metrics.perimeterM,
        lengthM: metrics.lengthM,
        widthM: metrics.widthM,
        facing,
        latitude: metrics.centroid.lat,
        longitude: metrics.centroid.lng,
        address: address?.address,
        city: address?.city,
        state: address?.state,
        country: address?.country,
      });
      setSave({ state: "saved" });
    } catch (e) {
      setSave({ state: "error", msg: e instanceof Error ? e.message : "Save failed" });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => mapRef.current?.startDrawing()}>
            <PencilRuler /> Draw boundary
          </Button>
          <Button size="sm" variant="outline" onClick={() => { mapRef.current?.clear(); setPoints([]); setReload((r) => r + 1); }}>
            <Trash2 /> Clear
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            Tip: drag points to adjust · right-click a point to delete
          </span>
        </div>

        {hasMapsKey && !mapFailed ? (
          <PlotMap
            ref={mapRef}
            initialPoints={initialPoints}
            reloadSignal={reload}
            onChange={handleChange}
            onError={(m) => { setMapError(m); setMapFailed(true); }}
          />
        ) : (
          <PlotMapFallback ref={mapRef} reloadSignal={reload} onChange={handleChange} />
        )}

        {mapError && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4" /> {mapError} — using offline drawing mode.
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <PlotInfoCard
          metrics={metrics}
          address={address}
          facing={facing}
          onFacingChange={(f) => { setFacing(f); setFacingTouched(true); }}
        />

        {points.length > 0 && !validation.ok && validation.error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" /> {validation.error}
          </div>
        )}

        {onContinue && (
          <Button className="w-full" disabled={!validation.ok} onClick={handleContinue}>
            {continueLabel} <ArrowRight />
          </Button>
        )}

        {onSave && (
          <Button className="w-full" variant={onContinue ? "outline" : "default"}
            disabled={!validation.ok || save.state === "saving"} onClick={doSave}>
            {save.state === "saving" ? <Loader2 className="animate-spin" /> :
             save.state === "saved" ? <CheckCircle2 /> : <Save />}
            {save.state === "saved" ? "Saved" : "Save plot"}
          </Button>
        )}

        {save.state === "error" && (
          <p className="text-center text-sm text-destructive">{save.msg}</p>
        )}
      </aside>
    </div>
  );
}
