"use client";

import * as React from "react";
import { Undo2, Redo2, Maximize2 } from "lucide-react";
import { placeOpenings, placeOpeningsPoly } from "@/lib/floorplan/engine";
import { generateWalls, generatePolygonWalls } from "@/lib/floorplan/walls";
import { ZONE_FILL } from "@/lib/floorplan/palette";
import { polygonCentroid } from "@/lib/floorplan/polygon-ops";
import type { Facing, FloorPlan, Polygon, Room, RoomType } from "@/lib/floorplan/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PAD = 1.8; // metres of margin around footprint in the viewBox
const PAPER = "#F6F4EE";
const WALL = "#2C2A26";
const OPENING_CUT = 0.74; // gap width that erases a wall for a door/window

const COMPASS_ROT: Record<Facing, number> = {
  N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315,
};

const ROOM_TYPES: RoomType[] = [
  "living", "dining", "kitchen", "foyer", "bedroom", "master_bedroom",
  "bathroom", "toilet", "pooja", "office", "stair", "store", "utility", "balcony", "parking",
];

interface Props {
  floor: FloorPlan;
  facing: Facing;
  editable?: boolean;
  className?: string;
}

type DragState =
  | { mode: "move"; id: string; ox: number; oy: number }
  | { mode: "resize"; id: string; ox: number; oy: number }
  | null;

export function FloorPlanCanvas({ floor, facing, editable = false, className }: Props) {
  const fp = floor.footprint;
  const fpPoly = floor.footprintPolygon;
  const isPolyMode = !!fpPoly && fpPoly.length >= 3;
  const vb = { x: fp.x - PAD, y: fp.y - PAD, w: fp.w + PAD * 2, h: fp.h + PAD * 2 };

  const [rooms, setRooms] = React.useState<Room[]>(floor.rooms);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [past, setPast] = React.useState<Room[][]>([]);
  const [future, setFuture] = React.useState<Room[][]>([]);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<DragState>(null);

  React.useEffect(() => {
    setRooms(floor.rooms);
    setPast([]);
    setFuture([]);
    setSelected(null);
  }, [floor]);

  // Walls, doors and windows are derived from the rooms, so they stay
  // consistent through every edit.
  const openings = React.useMemo(() => {
    return isPolyMode ? placeOpeningsPoly(rooms, fpPoly!) : placeOpenings(rooms, fp);
  }, [rooms, fp, isPolyMode, fpPoly]);

  const walls = React.useMemo(() => {
    return isPolyMode ? generatePolygonWalls(rooms, fpPoly!) : generateWalls(rooms, fp);
  }, [rooms, fp, isPolyMode, fpPoly]);

  const commit = (next: Room[]) => {
    setPast((p) => [...p, rooms]);
    setFuture([]);
    setRooms(next);
  };
  const undo = () => {
    setPast((p) => {
      if (!p.length) return p;
      setFuture((f) => [rooms, ...f]);
      setRooms(p[p.length - 1]);
      return p.slice(0, -1);
    });
  };
  const redo = () => {
    setFuture((f) => {
      if (!f.length) return f;
      setPast((p) => [...p, rooms]);
      setRooms(f[0]);
      return f.slice(1);
    });
  };

  const toMetres = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    const local = ctm ? pt.matrixTransform(ctm.inverse()) : pt;
    return { x: local.x, y: local.y };
  };
  const snap = (v: number) => Math.round(v / 0.25) * 0.25;

  const onPointerDown = (e: React.PointerEvent, id: string, mode: "move" | "resize") => {
    if (!editable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const m = toMetres(e);
    const room = rooms.find((r) => r.id === id)!;
    drag.current = { mode, id, ox: m.x - room.x, oy: m.y - room.y };
    setSelected(id);
    setPast((p) => [...p, rooms]);
    setFuture([]);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    const m = toMetres(e);
    setRooms((rs) =>
      rs.map((r) => {
        if (r.id !== d.id) return r;
        if (d.mode === "move") {
          let nx = snap(m.x - d.ox);
          let ny = snap(m.y - d.oy);
          nx = Math.max(fp.x, Math.min(nx, fp.x + fp.w - r.w));
          ny = Math.max(fp.y, Math.min(ny, fp.y + fp.h - r.h));
          return { ...r, x: nx, y: ny };
        }
        const nw = Math.max(1.5, snap(m.x - r.x));
        const nh = Math.max(1.5, snap(m.y - r.y));
        return { ...r, w: Math.min(nw, fp.x + fp.w - r.x), h: Math.min(nh, fp.y + fp.h - r.y) };
      }),
    );
  };
  const onPointerUp = () => { drag.current = null; };

  const changeType = (id: string, type: RoomType) =>
    commit(rooms.map((r) => (r.id === id ? { ...r, type, label: labelFor(type) } : r)));

  const sel = rooms.find((r) => r.id === selected) ?? null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={undo} disabled={!past.length}><Undo2 /> Undo</Button>
          <Button size="sm" variant="outline" onClick={redo} disabled={!future.length}><Redo2 /> Redo</Button>
          {sel && (
            <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-sm">
              <Maximize2 className="size-4 text-muted-foreground" />
              <select value={sel.type} onChange={(e) => changeType(sel.id, e.target.value as RoomType)}
                className="rounded-md border bg-background px-2 py-1 text-sm capitalize">
                {ROOM_TYPES.map((t) => <option key={t} value={t}>{labelFor(t)}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">{(sel.w * sel.h).toFixed(1)} m²</span>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border shadow-sm">
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          className="h-auto w-full touch-none select-none"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onClick={() => setSelected(null)}
        >
          <defs>
            <pattern id="fp-grid" width={1} height={1} patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#000" strokeOpacity={0.04} strokeWidth={0.02} />
            </pattern>
            <filter id="fp-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx={0.18} dy={0.3} stdDeviation={0.35} floodColor="#000" floodOpacity={0.18} />
            </filter>
          </defs>

          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={PAPER} />

          {/* Footprint background & grid */}
          {isPolyMode ? (
            <>
              <defs>
                <clipPath id="fp-clip">
                  <polygon points={polyPoints(fpPoly!)} />
                </clipPath>
              </defs>
              <rect x={fp.x} y={fp.y} width={fp.w} height={fp.h} fill="url(#fp-grid)" clipPath="url(#fp-clip)" />
              <polygon points={polyPoints(fpPoly!)} fill="#FFFFFF" filter="url(#fp-shadow)" />
            </>
          ) : (
            <>
              <rect x={fp.x} y={fp.y} width={fp.w} height={fp.h} fill="url(#fp-grid)" />
              <rect x={fp.x} y={fp.y} width={fp.w} height={fp.h} fill="#FFFFFF" filter="url(#fp-shadow)" />
            </>
          )}

          {/* Room fills (white with a faint zone tint) + interaction */}
          {rooms.map((r) => {
            const isSel = r.id === selected;
            const hasRPoly = !!r.polygon && r.polygon.length >= 3;
            return (
              <g key={r.id} onClick={(e) => { e.stopPropagation(); setSelected(r.id); }}>
                {hasRPoly ? (
                  <>
                    <polygon points={polyPoints(r.polygon!)} fill="#FFFFFF" />
                    <polygon points={polyPoints(r.polygon!)}
                      fill={ZONE_FILL[r.zone]} fillOpacity={isSel ? 0.2 : 0.08}
                      className={editable ? "cursor-move" : undefined}
                      onPointerDown={(e) => onPointerDown(e, r.id, "move")} />
                    {isSel && (
                      <polygon points={polyPoints(r.polygon!)} fill="none"
                        stroke="hsl(var(--primary))" strokeWidth={0.12} strokeDasharray="0.4 0.3" pointerEvents="none" />
                    )}
                  </>
                ) : (
                  <>
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#FFFFFF" />
                    <rect x={r.x} y={r.y} width={r.w} height={r.h}
                      fill={ZONE_FILL[r.zone]} fillOpacity={isSel ? 0.2 : 0.08}
                      className={editable ? "cursor-move" : undefined}
                      onPointerDown={(e) => onPointerDown(e, r.id, "move")} />
                    {isSel && (
                      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none"
                        stroke="hsl(var(--primary))" strokeWidth={0.12} strokeDasharray="0.4 0.3" pointerEvents="none" />
                    )}
                  </>
                )}
              </g>
            );
          })}

          {/* Walls (poché) */}
          {walls.map((w, i) => (
            <line key={`wall-${i}`} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
              stroke={WALL} strokeWidth={w.thickness} strokeLinecap="square" pointerEvents="none" />
          ))}

          {/* Door openings: erase the wall, then draw leaf + swing */}
          {openings.doors.map((d, i) => {
            const arcR = d.width;
            return (
              <g key={`door-${i}`} pointerEvents="none">
                {d.orientation === "v" ? (
                  <>
                    <line x1={d.x} y1={d.y} x2={d.x} y2={d.y + d.width} stroke={PAPER} strokeWidth={OPENING_CUT} />
                    <path d={`M ${d.x} ${d.y} v ${d.width} M ${d.x} ${d.y} a ${arcR} ${arcR} 0 0 1 ${arcR} ${arcR}`}
                      fill="none" stroke="#9A948A" strokeWidth={0.06} />
                  </>
                ) : (
                  <>
                    <line x1={d.x} y1={d.y} x2={d.x + d.width} y2={d.y} stroke={PAPER} strokeWidth={OPENING_CUT} />
                    <path d={`M ${d.x} ${d.y} h ${d.width} M ${d.x} ${d.y} a ${arcR} ${arcR} 0 0 0 ${arcR} ${arcR}`}
                      fill="none" stroke="#9A948A" strokeWidth={0.06} />
                  </>
                )}
              </g>
            );
          })}

          {/* Window openings: erase the wall, then draw the glass frame */}
          {openings.windows.map((w, i) => {
            const v = w.orientation === "v";
            return (
              <g key={`win-${i}`} pointerEvents="none">
                <line x1={w.x} y1={w.y} x2={v ? w.x : w.x + w.width} y2={v ? w.y + w.width : w.y}
                  stroke={PAPER} strokeWidth={OPENING_CUT} />
                {[-0.16, 0, 0.16].map((off, k) => (
                  <line key={k}
                    x1={v ? w.x + off : w.x} y1={v ? w.y : w.y + off}
                    x2={v ? w.x + off : w.x + w.width} y2={v ? w.y + w.width : w.y + off}
                    stroke={k === 1 ? "#7FB4D4" : "#5E8FB0"} strokeWidth={0.06} />
                ))}
              </g>
            );
          })}

          {/* Labels: name + dimensions + area */}
          {rooms.map((r) => {
            const big = r.w > 2.4 && r.h > 1.8;
            const fs = Math.min(0.62, r.w / 9, r.h / 5);
            // Use polygon centroid for better label placement in irregular shapes.
            const [cx, cy] = r.polygon && r.polygon.length >= 3
              ? polygonCentroid(r.polygon)
              : [r.x + r.w / 2, r.y + r.h / 2];
            return (
              <g key={`lbl-${r.id}`} pointerEvents="none" textAnchor="middle">
                <text x={cx} y={cy - (big ? 0.45 : 0)} dominantBaseline="middle"
                  fill="#3A372F" style={{ fontSize: Math.max(0.42, fs), fontWeight: 700 }}>
                  {r.label}
                </text>
                {big && (
                  <>
                    <text x={cx} y={cy + 0.5} dominantBaseline="middle"
                      fill="#7C766A" style={{ fontSize: 0.42, fontWeight: 600 }}>
                      {(r.w * 3.281).toFixed(1)}′ × {(r.h * 3.281).toFixed(1)}′
                    </text>
                    <text x={cx} y={cy + 1.15} dominantBaseline="middle"
                      fill="#9A948A" style={{ fontSize: 0.38, fontWeight: 600 }}>
                      {Math.round(r.w * r.h * 10.764)} ft²
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Resize handle */}
          {editable && sel && (
            <rect x={sel.x + sel.w - 0.55} y={sel.y + sel.h - 0.55} width={0.6} height={0.6} rx={0.1}
              fill="hsl(var(--primary))" className="cursor-se-resize"
              onPointerDown={(e) => onPointerDown(e, sel.id, "resize")} />
          )}

          {/* Compass */}
          <g transform={`translate(${vb.x + 1.2} ${vb.y + 1.2})`}>
            <circle r={0.85} fill="#FFFFFF" stroke="#D8D3C7" strokeWidth={0.07} />
            <g transform={`rotate(${COMPASS_ROT[facing]})`}>
              <path d="M 0 -0.62 L 0.22 0.16 L 0 0 L -0.22 0.16 Z" fill="#C0392B" />
            </g>
            <text y={-0.95} textAnchor="middle" style={{ fontSize: 0.36, fontWeight: 700 }} fill="#7C766A">N</text>
          </g>

          {/* Scale bar (5 m) */}
          <g transform={`translate(${fp.x + fp.w - 5} ${vb.y + vb.h - 0.7})`} stroke="#7C766A" fill="#7C766A">
            <line x1={0} y1={0} x2={5} y2={0} strokeWidth={0.09} />
            <line x1={0} y1={-0.16} x2={0} y2={0.16} strokeWidth={0.09} />
            <line x1={5} y1={-0.16} x2={5} y2={0.16} strokeWidth={0.09} />
            <text x={2.5} y={-0.32} textAnchor="middle" stroke="none" style={{ fontSize: 0.36, fontWeight: 600 }}>5 m · 16′</text>
          </g>
        </svg>
      </div>
    </div>
  );
}

function labelFor(t: RoomType): string {
  const map: Record<string, string> = {
    master_bedroom: "Master Bedroom",
    toilet: "Powder Room",
    bathroom: "Bathroom",
  };
  return map[t] ?? t.charAt(0).toUpperCase() + t.slice(1).replace("_", " ");
}

/** Convert a Polygon to an SVG points attribute string. */
function polyPoints(poly: Polygon): string {
  return poly.map(([x, y]) => `${x},${y}`).join(" ");
}
