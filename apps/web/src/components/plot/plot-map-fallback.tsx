"use client";

import * as React from "react";
import { MousePointerClick } from "lucide-react";
import type { PlotMapHandle } from "@/components/plot/plot-map";
import type { LatLng } from "@/lib/geo/plot-geometry";
import { cn } from "@/lib/utils";

/**
 * Key-free fallback: a lightweight SVG boundary editor that maps screen
 * pixels to lat/lng on a local plane, so every calculation and the
 * save/load flow work end-to-end without a Google Maps key.
 */
const ORIGIN = { lat: 12.9716, lng: 77.5946 };
const EARTH_R = 6378137;
const D2R = Math.PI / 180;
const MPP = 0.25; // metres per pixel
const W = 720;
const H = 460;

const DEMO_PX = [
  { x: 250, y: 160 }, { x: 470, y: 160 }, { x: 470, y: 320 }, { x: 250, y: 320 },
];

function pxToLatLng(px: { x: number; y: number }): LatLng {
  const east = (px.x - W / 2) * MPP;
  const north = (H / 2 - px.y) * MPP;
  return {
    lat: ORIGIN.lat + north / EARTH_R / D2R,
    lng: ORIGIN.lng + east / (EARTH_R * Math.cos(ORIGIN.lat * D2R)) / D2R,
  };
}

interface Props {
  onChange: (points: LatLng[]) => void;
  reloadSignal?: number;
  initialPx?: { x: number; y: number }[];
  className?: string;
}

export const PlotMapFallback = React.forwardRef<PlotMapHandle, Props>(
  function PlotMapFallback({ onChange, reloadSignal = 0, className }, ref) {
    const [pts, setPts] = React.useState<{ x: number; y: number }[]>([]);
    const [drawing, setDrawing] = React.useState(false);
    const dragIdx = React.useRef<number | null>(null);
    const svgRef = React.useRef<SVGSVGElement>(null);
    const onChangeRef = React.useRef(onChange);
    onChangeRef.current = onChange;

    const emit = (next: { x: number; y: number }[]) =>
      onChangeRef.current(next.map(pxToLatLng));

    React.useEffect(() => {
      setPts([]);
      setDrawing(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadSignal]);

    React.useImperativeHandle(ref, () => ({
      startDrawing: () => {
        setPts([]);
        setDrawing(true);
        onChangeRef.current([]);
      },
      clear: () => {
        setPts([]);
        setDrawing(false);
        onChangeRef.current([]);
      },
    }));

    const toSvg = (e: React.PointerEvent) => {
      const r = svgRef.current!.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * W,
        y: ((e.clientY - r.top) / r.height) * H,
      };
    };

    const onClick = (e: React.PointerEvent) => {
      if (!drawing) return;
      const next = [...pts, toSvg(e)];
      setPts(next);
      emit(next);
    };

    const onPointerMove = (e: React.PointerEvent) => {
      if (dragIdx.current == null) return;
      const p = toSvg(e);
      const next = pts.map((q, i) => (i === dragIdx.current ? p : q));
      setPts(next);
      emit(next);
    };

    const loadDemo = () => {
      setPts(DEMO_PX);
      setDrawing(false);
      emit(DEMO_PX);
    };

    const d = pts.length
      ? `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")} ${pts.length > 2 ? "Z" : ""}`
      : "";

    return (
      <div className={cn("relative overflow-hidden rounded-2xl border bg-card", className)}>
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-xl glass-strong px-3 py-2 text-xs text-muted-foreground shadow-glass">
          <MousePointerClick className="size-3.5" />
          {drawing ? "Click to add corner points" : "Demo mode — no Maps key"}
          <button onClick={loadDemo} className="ml-1 rounded-md bg-primary px-2 py-0.5 font-medium text-primary-foreground">
            Load demo plot
          </button>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={cn("h-[420px] w-full touch-none select-none sm:h-[460px]", drawing && "cursor-crosshair")}
          style={{ background:
            "repeating-linear-gradient(0deg,transparent,transparent 23px,rgba(120,120,140,.12) 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,rgba(120,120,140,.12) 24px)" }}
          onPointerDown={onClick}
          onPointerMove={onPointerMove}
          onPointerUp={() => (dragIdx.current = null)}
        >
          {d && <path d={d} fill="#6366f1" fillOpacity={0.22} stroke="#6366f1" strokeWidth={2.5} />}
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={7}
              className="fill-primary stroke-white"
              strokeWidth={2}
              style={{ cursor: "grab" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                dragIdx.current = i;
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (pts.length > 3) {
                  const next = pts.filter((_, j) => j !== i);
                  setPts(next);
                  emit(next);
                }
              }}
            />
          ))}
        </svg>
      </div>
    );
  },
);
