"use client";

import { Ruler, Compass, MapPin, Maximize, Move, Spline } from "lucide-react";
import type { Facing } from "@/lib/floorplan/types";
import type { PlotMetrics } from "@/lib/geo/plot-geometry";
import type { PlotAddress } from "@/lib/maps/geocode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const FACINGS: Facing[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const fmt = (n: number, d = 0) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: d }).format(n);

function Stat({ icon: Icon, label, value, sub }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-1 font-display text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

interface Props {
  metrics: PlotMetrics | null;
  address: PlotAddress | null;
  facing: Facing;
  onFacingChange: (f: Facing) => void;
}

export function PlotInfoCard({ metrics, address, facing, onFacingChange }: Props) {
  return (
    <Card glass>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Ruler className="size-5 text-primary" /> Plot details
        </CardTitle>
        {metrics && <Badge variant="muted">{metrics.vertices} corners</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        {!metrics ? (
          <p className="text-sm text-muted-foreground">
            Draw your plot boundary on the map to see area, dimensions and orientation.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat icon={Maximize} label="Area" value={`${fmt(metrics.areaSqft)} ft²`} sub={`${fmt(metrics.areaSqm, 1)} m²`} />
              <Stat icon={Spline} label="Perimeter" value={`${fmt(metrics.perimeterM, 1)} m`} />
              <Stat icon={Move} label="Length" value={`${fmt(metrics.lengthM, 1)} m`} sub={`${fmt(metrics.lengthM * 3.281, 1)} ft`} />
              <Stat icon={Move} label="Width" value={`${fmt(metrics.widthM, 1)} m`} sub={`${fmt(metrics.widthM * 3.281, 1)} ft`} />
            </div>

            <div className="rounded-xl border bg-card/50 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Compass className="size-3.5" /> Facing direction
                <span className="ml-auto">auto: {metrics.facing}</span>
              </div>
              <div className="mt-2 grid grid-cols-8 gap-1">
                {FACINGS.map((f) => (
                  <button
                    key={f}
                    onClick={() => onFacingChange(f)}
                    className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                      facing === f ? "bg-primary text-primary-foreground" : "border hover:bg-secondary/60"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-xl border bg-card/50 p-3 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>{address?.address || "Address will appear once geocoded"}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>City: <b className="text-foreground">{address?.city || "—"}</b></span>
                <span>State: <b className="text-foreground">{address?.state || "—"}</b></span>
                <span>Country: <b className="text-foreground">{address?.country || "—"}</b></span>
                <span>Lat/Lng: <b className="text-foreground tabular-nums">{metrics.centroid.lat.toFixed(5)}, {metrics.centroid.lng.toFixed(5)}</b></span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
