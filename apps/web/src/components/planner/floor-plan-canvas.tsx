"use client";

import * as React from "react";
import { Undo2, Redo2, Maximize2 } from "lucide-react";
import { useTheme } from "next-themes";
import { furnish } from "@/lib/floorplan/furniture";
import { placeOpenings } from "@/lib/floorplan/engine";
import { generateWalls } from "@/lib/floorplan/walls";
import { pointInPolygon, polygonBBox } from "@/lib/floorplan/polygon-ops";
import type { Door, FloorPlan, Polygon, Room, RoomType, SitePlan, Wall, WindowMark } from "@/lib/floorplan/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ftIn } from "@/lib/floorplan/units";

export const PAD = 2.2; // metres of margin around the plot
/** Drawing palettes: trace paper (light) and blueprint (dark). Concrete colours, so exports are self-contained. */
export const LIGHT = {
  paper: "#F7F6F2",
  sheet: "#FFFFFF",
  ground: "#EEEDE6",
  plotLine: "#8A8678",
  setback: "#B7B3A6",
  room: "#FFFFFF",
  wall: "#1B1D22",
  railing: "#5E626B",
  ink: "#1B1D22",
  inkSoft: "#5B606B",
  inkFaint: "#9A9C9F",
  furniture: "#666B74",
  door: "#7D8189",
  glass: "#2A4BD7",
  grass: "#E3EBD7",
  grassInk: "#97AE7E",
  water: "#DCE9F7",
  waterInk: "#5D86C4",
  paving: "#F1EFE8",
  pavingLine: "#DEDAD0",
  tile: "#EEF1F4",
  tileLine: "#D3D9E0",
  deck: "#F3EEE4",
  deckLine: "#E0D6C4",
  accent: "#2A4BD7",
  shadow: "rgba(0,0,0,0.07)",
  /** Colour presentation style: textured floors, coloured furniture, trees. */
  colour: false,
  wood: "#FFFFFF",
  woodLine: "#FFFFFF",
  marble: "#FFFFFF",
  marbleLine: "#FFFFFF",
  fabric: "#FFFFFF",
  sofa: "#FFFFFF",
  counter: "#FFFFFF",
  sanitary: "#FFFFFF",
  tree: "#E3EBD7",
  treeInk: "#97AE7E",
  cars: ["#FFFFFF"],
};
export type Palette = typeof LIGHT;
export const BLUEPRINT: Palette = {
  paper: "#0F2240",
  sheet: "#12284A",
  ground: "#14294B",
  plotLine: "#9DB4D6",
  setback: "#4F6D99",
  room: "#12284A",
  wall: "#E8F0FB",
  railing: "#B9CBE6",
  ink: "#EAF1FB",
  inkSoft: "#B4C6E0",
  inkFaint: "#7F98BD",
  furniture: "#93ABCF",
  door: "#93ABCF",
  glass: "#7CC4FF",
  grass: "#163055",
  grassInk: "#6E8FBF",
  water: "#18355F",
  waterInk: "#7CC4FF",
  paving: "#13294C",
  pavingLine: "#22406B",
  tile: "#13294C",
  tileLine: "#26466F",
  deck: "#13294C",
  deckLine: "#26466F",
  accent: "#7CC4FF",
  shadow: "rgba(0,0,0,0)",
  colour: false,
  wood: "#12284A",
  woodLine: "#12284A",
  marble: "#12284A",
  marbleLine: "#12284A",
  fabric: "#12284A",
  sofa: "#12284A",
  counter: "#12284A",
  sanitary: "#12284A",
  tree: "#163055",
  treeInk: "#6E8FBF",
  cars: ["#12284A"],
};

/** Colour presentation plan: the look of a rendered brochure plan. */
export const PRESENTATION: Palette = {
  ...LIGHT,
  paper: "#FBFAF6",
  ground: "#DCE8C6",
  plotLine: "#6F7F55",
  setback: "#A9B98C",
  room: "#F4EEE3",
  wall: "#3A3833",
  railing: "#55524B",
  ink: "#2A2925",
  inkSoft: "#5F5B52",
  inkFaint: "#8E897D",
  furniture: "#7A7265",
  door: "#8D857A",
  glass: "#4E8FD0",
  grass: "#B9D597",
  grassInk: "#7FA35A",
  water: "#7FC6E8",
  waterInk: "#2E86B9",
  paving: "#E4DED2",
  pavingLine: "#CFC6B6",
  tile: "#E9EEF0",
  tileLine: "#C9D3D8",
  deck: "#D7B48A",
  deckLine: "#B88F62",
  shadow: "rgba(40,30,15,0.18)",
  colour: true,
  wood: "#D9B68C",
  woodLine: "#C49A6C",
  marble: "#EFEBE4",
  marbleLine: "#DCD5CA",
  fabric: "#E9DCC9",
  sofa: "#A8B5C2",
  counter: "#6E6A66",
  sanitary: "#FFFFFF",
  tree: "#6FA85A",
  treeInk: "#4D7D3B",
  cars: ["#C8463D", "#3E6FB0", "#E8E6E1", "#2F3238"],
};
export const Pal = React.createContext<Palette>(LIGHT);

/** Key to the drawing's fills, in the current theme's palette. */
export function PlanLegend() {
  const { resolvedTheme } = useTheme();
  const C = resolvedTheme === "dark" ? BLUEPRINT : LIGHT;
  const items: [string, string][] = [
    ["Indoor", C.room], ["Wet areas", C.tile], ["Sit-out / balcony", C.deck],
    ["Paving / terrace", C.paving], ["Garden", C.grass], ["Pool", C.water],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {items.map(([l, c]) => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border" style={{ background: c }} /> {l}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-0 w-4 border-t border-dashed" style={{ borderColor: C.setback }} /> Setback line
      </span>
    </div>
  );
}

const OPEN_ROOMS: RoomType[] = ["sitout", "balcony", "terrace", "parking"];
const WET_ROOMS: RoomType[] = ["bathroom", "toilet", "utility"];

const ROOM_TYPES: RoomType[] = [
  "living", "lounge", "dining", "kitchen", "bedroom", "master_bedroom", "bathroom", "toilet",
  "dress", "pooja", "office", "stair", "store", "utility", "corridor", "sitout", "balcony", "terrace",
];

/** Title-block details printed on the drawing sheet. */
export interface SheetMeta {
  project: string;
  subtitle: string;
  date: string;
}

interface Props {
  floor: FloorPlan;
  site: SitePlan;
  meta?: SheetMeta;
  /** Force a palette (e.g. "light" for printing, "presentation" for the colour plan); defaults to the current theme. */
  palette?: "light" | "blueprint" | "presentation";
  /** "plan" frames the house; "site" shows the whole plot. */
  view?: "plan" | "site";
  editable?: boolean;
  className?: string;
}

type DragState =
  | { mode: "move"; id: string; ox: number; oy: number }
  | { mode: "resize"; id: string; ox: number; oy: number }
  | null;

export function FloorPlanCanvas({ floor, site, meta, view = "plan", editable = false, className, palette }: Props) {
  const { resolvedTheme } = useTheme();
  const pal = palette ?? (resolvedTheme === "dark" ? "blueprint" : "light");
  const C = pal === "presentation" ? PRESENTATION : pal === "blueprint" ? BLUEPRINT : LIGHT;
  const fp = floor.footprint;
  const isGround = floor.floor === 0;
  const bb = polygonBBox(site.plot);
  const M = 4.2; // margin around the house in plan view (room for dimension chains)
  const area = view === "site"
    ? { x: bb.x - PAD, y: bb.y - PAD, w: bb.w + PAD * 2, h: bb.h + PAD * 2 }
    : { x: fp.x - M, y: fp.y - M, w: fp.w + M * 2, h: fp.h + M * 2 };
  const s = Math.max(area.w, area.h) / 30; // marker scale relative to a 30 m drawing
  // The sheet adds a title strip under the drawing area.
  const titleH = 2.6 * s;
  const vb = { x: area.x, y: area.y, w: area.w, h: area.h + titleH };

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

  // Walls, doors and windows derive from the rooms, so edits stay consistent.
  const openings = React.useMemo(() => placeOpenings(rooms, fp, floor.roadSide, floor.access), [rooms, fp, floor.roadSide, floor.access]);
  const walls = React.useMemo(() => generateWalls(rooms), [rooms]);
  const furniture = React.useMemo(
    () => rooms.flatMap((r) => furnish(r, openings.doors, openings.windows).map((sh) => ({ sh, type: r.type }))),
    [rooms, openings],
  );
  // Colour plan: trees in the open land around the house (ground floor only).
  const trees = React.useMemo(() => (C.colour && isGround ? plantTrees(site, fp) : []), [C.colour, isGround, site, fp]);
  const chains = React.useMemo(() => dimensionChains(rooms, fp), [rooms, fp]);

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
  const snap = (v: number) => Math.round(v / 0.15) * 0.15;

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
          const nx = Math.max(fp.x, Math.min(snap(m.x - d.ox), fp.x + fp.w - r.w));
          const ny = Math.max(fp.y, Math.min(snap(m.y - d.oy), fp.y + fp.h - r.h));
          return { ...r, x: nx, y: ny };
        }
        const nw = Math.max(1.2, snap(m.x - r.x));
        const nh = Math.max(1.2, snap(m.y - r.y));
        return { ...r, w: Math.min(nw, fp.x + fp.w - r.x), h: Math.min(nh, fp.y + fp.h - r.y) };
      }),
    );
  };
  const onPointerUp = () => { drag.current = null; };

  const changeType = (id: string, type: RoomType) =>
    commit(rooms.map((r) => (r.id === id ? { ...r, type, label: labelFor(type) } : r)));

  const sel = rooms.find((r) => r.id === selected) ?? null;
  const landscaped = isGround && site.elements.some((e) => e.type === "garden");
  const roadMid = roadLabelPos(site, vb);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={undo} disabled={!past.length}><Undo2 /> Undo</Button>
          <Button size="sm" variant="outline" onClick={redo} disabled={!future.length}><Redo2 /> Redo</Button>
          {sel && (
            <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
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

      <div className="overflow-hidden rounded-lg border shadow-sm">
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          className="h-auto w-full touch-none select-none"
          style={{ fontFamily: "var(--font-sans, ui-sans-serif, system-ui)" }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onClick={() => setSelected(null)}
        >
          <defs>
            <pattern id="fp-tile" width={0.3} height={0.3} patternUnits="userSpaceOnUse">
              <rect width={0.3} height={0.3} fill={C.tile} />
              <path d="M 0.3 0 L 0 0 0 0.3" fill="none" stroke={C.tileLine} strokeWidth={0.012} />
            </pattern>
            <pattern id="fp-paving" width={0.6} height={0.6} patternUnits="userSpaceOnUse">
              <rect width={0.6} height={0.6} fill={C.paving} />
              <path d="M 0.6 0 L 0 0 0 0.6" fill="none" stroke={C.pavingLine} strokeWidth={0.015} />
            </pattern>
            <pattern id="fp-deck" width={0.15} height={1} patternUnits="userSpaceOnUse">
              <rect width={0.15} height={1} fill={C.deck} />
              <path d="M 0.15 0 L 0.15 1" stroke={C.deckLine} strokeWidth={0.012} />
            </pattern>
            <pattern id="fp-wood" width={1.8} height={0.18} patternUnits="userSpaceOnUse">
              <rect width={1.8} height={0.18} fill={C.wood} />
              <path d="M 0 0.18 L 1.8 0.18 M 1.1 0 L 1.1 0.18" stroke={C.woodLine} strokeWidth={0.012} />
            </pattern>
            <pattern id="fp-marble" width={0.6} height={0.6} patternUnits="userSpaceOnUse">
              <rect width={0.6} height={0.6} fill={C.marble} />
              <path d="M 0.6 0 L 0 0 0 0.6" fill="none" stroke={C.marbleLine} strokeWidth={0.01} />
              <path d="M 0.05 0.42 q 0.15 -0.1 0.3 0 t 0.22 -0.08" fill="none" stroke={C.marbleLine} strokeWidth={0.008} />
            </pattern>
            <pattern id="fp-grass" width={0.8} height={0.8} patternUnits="userSpaceOnUse">
              <rect width={0.8} height={0.8} fill={C.grass} />
              <path d="M 0.2 0.5 l 0.05 -0.12 l 0.05 0.12 M 0.55 0.25 l 0.05 -0.12 l 0.05 0.12" fill="none" stroke={C.grassInk} strokeWidth={0.02} />
            </pattern>
          </defs>

          <Pal.Provider value={C}>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={C.paper} />

          {/* Plot, setback line and road */}
          <polygon points={pts(site.plot)} fill={landscaped || (C.colour && isGround) ? "url(#fp-grass)" : C.ground} stroke={C.plotLine} strokeWidth={0.06 * s}
            strokeDasharray={`${0.9 * s} ${0.25 * s} ${0.15 * s} ${0.25 * s}`} />
          {isGround && (site.setbackLine && site.setbackLine.length >= 3 ? (
            <polygon points={pts(site.setbackLine)} fill="none" stroke={C.setback} strokeWidth={0.035 * s}
              strokeDasharray={`${0.3 * s} ${0.2 * s}`} />
          ) : (
            <rect x={site.buildable.x} y={site.buildable.y} width={site.buildable.w} height={site.buildable.h}
              fill="none" stroke={C.setback} strokeWidth={0.035 * s} strokeDasharray={`${0.3 * s} ${0.2 * s}`} />
          ))}
          <text x={roadMid.x} y={roadMid.y} textAnchor="middle" dominantBaseline="middle"
            transform={roadMid.rotate ? `rotate(-90 ${roadMid.x} ${roadMid.y})` : undefined}
            fill={C.inkFaint} style={{ fontSize: 0.42 * s, fontWeight: 700, letterSpacing: 0.25 * s }}>
            ROAD
          </text>

          {/* Site elements (faded above the ground floor) */}
          <g opacity={isGround ? 1 : 0.35} pointerEvents="none">
            {site.elements.map((e, i) => (
              <g key={e.id}>
                {e.type === "garden" && <GardenShape x={e.x} y={e.y} w={e.w} h={e.h} />}
                {e.type === "pool" && <PoolShape x={e.x} y={e.y} w={e.w} h={e.h} />}
                {e.type === "parking" && <CarShape x={e.x} y={e.y} w={e.w} h={e.h} tone={i} />}
                {e.type !== "parking" && (
                  <text x={e.x + e.w / 2} y={e.y + e.h / 2} textAnchor="middle" dominantBaseline="middle"
                    fill={C.inkSoft} style={{ fontSize: Math.min(0.5, e.w / 7, e.h / 3), fontWeight: 600 }}>
                    {e.label}
                  </text>
                )}
              </g>
            ))}
          </g>

          {trees.map(([tx, ty, r], i) => (
            <g key={`tree-${i}`} pointerEvents="none">
              <circle cx={tx + 0.25} cy={ty + 0.3} r={r} fill={C.shadow} />
              <circle cx={tx} cy={ty} r={r} fill={C.tree} stroke={C.treeInk} strokeWidth={0.05} />
              <circle cx={tx - r * 0.3} cy={ty - r * 0.3} r={r * 0.45} fill={C.grass} opacity={0.55} />
            </g>
          ))}

          {/* House shadow */}
          {floor.footprintPolygon && floor.footprintPolygon.length >= 3
            ? <polygon points={pts(floor.footprintPolygon)} transform="translate(0.12 0.18)" fill={C.shadow} />
            : <rect x={fp.x + 0.12} y={fp.y + 0.18} width={fp.w} height={fp.h} fill={C.shadow} />}

          {/* Room floors */}
          {rooms.map((r) => {
            const isSel = r.id === selected;
            const fill = r.type === "terrace" ? "url(#fp-paving)"
              : r.type === "sitout" || r.type === "balcony" ? "url(#fp-deck)"
                : r.type === "parking" ? "url(#fp-paving)"
                  : WET_ROOMS.includes(r.type) ? "url(#fp-tile)"
                    : C.colour && WOOD_FLOORS.includes(r.type) ? "url(#fp-wood)"
                      : C.colour ? "url(#fp-marble)" : C.room;
            return (
              <g key={r.id} onClick={(e) => { e.stopPropagation(); setSelected(r.id); }}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill}
                  className={editable ? "cursor-move" : undefined}
                  onPointerDown={(e) => onPointerDown(e, r.id, "move")} />
                {isSel && (
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={C.accent} fillOpacity={0.12}
                    stroke={C.accent} strokeWidth={0.07} strokeDasharray="0.3 0.2" pointerEvents="none" />
                )}
              </g>
            );
          })}

          {/* Fixtures */}
          <g pointerEvents="none">
            {rooms.filter((r) => r.type === "stair").map((r) => <StairShape key={`st-${r.id}`} r={r} />)}
            {rooms.filter((r) => r.type === "lift").map((r) => <LiftShape key={`lift-${r.id}`} r={r} />)}
            {rooms.filter((r) => r.type === "parking" && /^Car/.test(r.label)).map((r, i) => (
              <CarShape key={`car-${r.id}`} x={r.x + 0.15} y={r.y + 0.15} w={r.w - 0.3} h={r.h - 0.3} tone={i} />
            ))}
          </g>

          {/* Furniture */}
          <g pointerEvents="none" fill={C.room} stroke={C.furniture} strokeWidth={0.035}>
            {furniture.map(({ sh, type }, i) => {
              const fill = C.colour ? furnitureFill(C, type) : C.room;
              return sh.kind === "rect"
                ? <rect key={i} x={sh.x} y={sh.y} width={sh.w} height={sh.h} rx={sh.rx} fill={fill} />
                : sh.kind === "circle"
                  ? <circle key={i} cx={sh.cx} cy={sh.cy} r={sh.r} fill={fill} />
                  : <line key={i} x1={sh.x1} y1={sh.y1} x2={sh.x2} y2={sh.y2} />;
            })}
          </g>

          {/* Walls (the colour plan gives them a soft shadow) */}
          {C.colour && (
            <g transform="translate(0.06 0.09)" opacity={0.6}>
              {walls.filter((w) => w.type !== "railing").map((w, i) => (
                <line key={`ws-${i}`} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={C.shadow} strokeWidth={w.thickness} strokeLinecap="square" />
              ))}
            </g>
          )}
          {walls.map((w, i) => <WallLine key={`w-${i}`} w={w} />)}

          {/* Doors & windows cut the walls */}
          {openings.windows.map((w, i) => <WindowMarkShape key={`win-${i}`} w={w} walls={walls} />)}
          {openings.doors.map((d, i) => <DoorShape key={`door-${i}`} d={d} walls={walls} />)}

          {/* Labels */}
          {rooms.map((r) => {
            if (r.type === "corridor" && Math.min(r.w, r.h) < 1.5) return null;
            const area = r.w * r.h;
            const fs = Math.max(0.22, Math.min(0.42, r.w / 8, r.h / 4));
            const showDims = r.w > 1.8 && r.h > 1.6 && !OPEN_ROOMS.includes(r.type);
            const cx = r.x + r.w / 2;
            const cy = r.y + r.h / 2;
            const vertical = r.h > r.w * 1.8 && r.w < 1.7;
            return (
              <g key={`lbl-${r.id}`} pointerEvents="none" textAnchor="middle"
                transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
                // Paper-coloured halo keeps labels legible over furniture.
                stroke={C.room} strokeWidth={0.09} strokeLinejoin="round" paintOrder="stroke">
                <text x={cx} y={cy - (showDims ? fs * 0.55 : 0)} dominantBaseline="middle" fill={C.ink}
                  style={{ fontSize: fs, fontWeight: 650, letterSpacing: 0.01 }}>
                  {(r.unit && r.type === "living" ? `${r.label} · ${r.unit}` : r.label).toUpperCase()}
                </text>
                {showDims && (
                  <text x={cx} y={cy + fs * 0.75} dominantBaseline="middle" fill={C.inkSoft}
                    style={{ fontSize: fs * 0.82, fontWeight: 500 }}>
                    {ftIn(r.w)} × {ftIn(r.h)}
                  </text>
                )}
                {showDims && area > 9 && (
                  <text x={cx} y={cy + fs * 1.75} dominantBaseline="middle" fill={C.inkFaint}
                    style={{ fontSize: fs * 0.7, fontWeight: 500 }}>
                    {Math.round(area * 10.764)} sq ft
                  </text>
                )}
              </g>
            );
          })}

          {/* Dimension chains (room by room) and overall dimensions */}
          {chains.top.map(([a, b], i) => (
            <DimLine key={`dt-${i}`} x1={a} y1={fp.y - 1.0} x2={b} y2={fp.y - 1.0} label={b - a >= 1.1 ? ftIn(b - a) : ""} s={s} />
          ))}
          {chains.left.map(([a, b], i) => (
            <DimLine key={`dl-${i}`} x1={fp.x - 1.0} y1={a} x2={fp.x - 1.0} y2={b} label={b - a >= 1.1 ? ftIn(b - a) : ""} s={s} vertical />
          ))}
          <DimLine x1={fp.x} y1={fp.y - 1.9} x2={fp.x + fp.w} y2={fp.y - 1.9} label={`${ftIn(fp.w)}  ·  ${fp.w.toFixed(2)} m`} s={s} strong />
          <DimLine x1={fp.x - 1.9} y1={fp.y} x2={fp.x - 1.9} y2={fp.y + fp.h} label={`${ftIn(fp.h)}  ·  ${fp.h.toFixed(2)} m`} s={s} vertical strong />

          {/* Resize handle */}
          {editable && sel && (
            <rect x={sel.x + sel.w - 0.45} y={sel.y + sel.h - 0.45} width={0.5} height={0.5} rx={0.08}
              fill={C.accent} className="cursor-se-resize"
              onPointerDown={(e) => onPointerDown(e, sel.id, "resize")} />
          )}

          {/* North arrow (north is always up) and scale bar */}
          <g transform={`translate(${vb.x + vb.w - 1.3 * s} ${vb.y + 1.4 * s}) scale(${s}) rotate(${site.northDeg ?? 0})`} pointerEvents="none">
            <circle r={0.75} fill={C.sheet} stroke={C.inkFaint} strokeWidth={0.05} />
            <path d="M 0 -0.58 L 0.24 0.3 L 0 0.12 L -0.24 0.3 Z" fill={C.ink} />
            <text y={-0.9} textAnchor="middle" style={{ fontSize: 0.36, fontWeight: 800 }} fill={C.ink}>N</text>
          </g>
          <g transform={`translate(${vb.x + 0.8 * s} ${vb.y + vb.h - 0.7 * s})`} pointerEvents="none" fill={C.inkSoft}>
            {[0, 1, 2, 3, 4].map((i) => (
              <rect key={i} x={i} y={-0.12 * s} width={1} height={0.12 * s} fill={i % 2 ? C.sheet : C.inkSoft} stroke={C.inkSoft} strokeWidth={0.02 * s} />
            ))}
            <text x={0} y={-0.32 * s} style={{ fontSize: 0.3 * s, fontWeight: 600 }}>0</text>
            <text x={5} y={-0.32 * s} textAnchor="middle" style={{ fontSize: 0.3 * s, fontWeight: 600 }}>5 m</text>
          </g>

          <TitleBlock x={vb.x} y={area.y + area.h} w={vb.w} h={titleH} s={s} meta={meta} floorName={floor.name} />
          <rect x={vb.x + 0.25 * s} y={vb.y + 0.25 * s} width={vb.w - 0.5 * s} height={vb.h - 0.5 * s}
            fill="none" stroke={C.ink} strokeWidth={0.05 * s} pointerEvents="none" />
          </Pal.Provider>
        </svg>
      </div>
    </div>
  );
}

function pts(poly: Polygon): string {
  return poly.map(([x, y]) => `${x},${y}`).join(" ");
}

/** "ROAD" label on the drawing edge that faces the road. */
function roadLabelPos(site: SitePlan, vb: { x: number; y: number; w: number; h: number }) {
  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  const m = Math.max(vb.w, vb.h) / 34;
  switch (site.roadSide) {
    case "N": return { x: cx, y: vb.y + m, rotate: false };
    case "S": return { x: cx, y: vb.y + vb.h - m, rotate: false };
    case "E": return { x: vb.x + vb.w - m, y: cy, rotate: true };
    case "W": return { x: vb.x + m, y: cy, rotate: true };
  }
}

const WOOD_FLOORS: RoomType[] = ["living", "lounge", "dining", "bedroom", "master_bedroom", "office", "dress"];

/** Colour plan: furniture tinted by the room it stands in. */
function furnitureFill(C: Palette, type: RoomType): string {
  if (type === "bedroom" || type === "master_bedroom" || type === "dress") return C.fabric;
  if (type === "living" || type === "lounge" || type === "office" || type === "sitout" || type === "balcony") return C.sofa;
  if (type === "kitchen" || type === "utility") return C.counter;
  if (type === "bathroom" || type === "toilet") return C.sanitary;
  if (type === "dining") return C.wood;
  return C.room;
}

/** Trees in the open land: a loose grid, kept off the house, the outdoor features and the plot edge. */
function plantTrees(site: SitePlan, fp: { x: number; y: number; w: number; h: number }): [number, number, number][] {
  const bb = polygonBBox(site.plot);
  const out: [number, number, number][] = [];
  const clear = (x: number, y: number, r: number) =>
    pointInPolygon([x, y], site.plot)
    && [[x - r, y], [x + r, y], [x, y - r], [x, y + r]].every((q) => pointInPolygon(q as [number, number], site.plot))
    && (x < fp.x - r - 0.6 || x > fp.x + fp.w + r + 0.6 || y < fp.y - r - 0.6 || y > fp.y + fp.h + r + 0.6)
    && site.elements.every((e) => x < e.x - r - 0.3 || x > e.x + e.w + r + 0.3 || y < e.y - r - 0.3 || y > e.y + e.h + r + 0.3);
  const step = 2.6;
  for (let y = bb.y + 1.0; y < bb.y + bb.h - 0.8; y += step) {
    for (let x = bb.x + 1.0; x < bb.x + bb.w - 0.8; x += step) {
      // Stagger rows and vary sizes, deterministically.
      const jx = x + ((Math.round(y / step) % 2) * step) / 2;
      const r = 0.7 + ((Math.round(jx * 7 + y * 3) % 5) * 0.12);
      if (clear(jx, y, r)) out.push([jx, y, r]);
    }
  }
  // The front strip along the road stays open for the gate and drive.
  return out.filter(([, y]) => y < bb.y + bb.h - 2.4).slice(0, 48);
}

function WallLine({ w }: { w: Wall }) {
  const C = React.useContext(Pal);
  if (w.type === "railing") {
    const off = 0.05;
    const v = w.orientation === "v";
    return (
      <g pointerEvents="none" stroke={C.railing} strokeWidth={0.025}>
        <line x1={w.x1 - (v ? off : 0)} y1={w.y1 - (v ? 0 : off)} x2={w.x2 - (v ? off : 0)} y2={w.y2 - (v ? 0 : off)} />
        <line x1={w.x1 + (v ? off : 0)} y1={w.y1 + (v ? 0 : off)} x2={w.x2 + (v ? off : 0)} y2={w.y2 + (v ? 0 : off)} />
      </g>
    );
  }
  return (
    <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={C.wall} strokeWidth={w.thickness}
      strokeLinecap="square" pointerEvents="none" />
  );
}

/** Thickest wall at an opening (so the cut fully erases it). */
function wallThicknessAt(o: { x: number; y: number; orientation: "h" | "v" }, walls: Wall[]): number {
  const hit = walls.filter((w) => w.orientation === o.orientation && w.type !== "railing" && (o.orientation === "v"
    ? Math.abs(w.x1 - o.x) < 0.03 && o.y >= Math.min(w.y1, w.y2) - 0.05 && o.y <= Math.max(w.y1, w.y2) + 0.05
    : Math.abs(w.y1 - o.y) < 0.03 && o.x >= Math.min(w.x1, w.x2) - 0.05 && o.x <= Math.max(w.x1, w.x2) + 0.05));
  return Math.max(0.12, ...hit.map((w) => w.thickness));
}

function DoorShape({ d, walls }: { d: Door; walls: Wall[] }) {
  const C = React.useContext(Pal);
  const t = wallThicknessAt(d, walls) + 0.02;
  const v = d.orientation === "v";
  const w = d.width;
  const sgn = d.swing ?? 1;
  const cut = v
    ? <rect x={d.x - t / 2} y={d.y} width={t} height={w} fill={C.room} />
    : <rect x={d.x} y={d.y - t / 2} width={w} height={t} fill={C.room} />;
  if (d.kind === "opening") return <g pointerEvents="none">{cut}</g>;
  // Leaf drawn open at 90°, with a quarter-circle swing back to the frame.
  const hx = d.x;
  const hy = d.y;
  const leaf = v ? { x: hx + sgn * w, y: hy } : { x: hx, y: hy + sgn * w };
  const end = v ? { x: hx, y: hy + w } : { x: hx + w, y: hy };
  const sweep = v ? (sgn > 0 ? 1 : 0) : (sgn > 0 ? 0 : 1);
  const main = d.kind === "main";
  return (
    <g pointerEvents="none">
      {cut}
      <line x1={hx} y1={hy} x2={leaf.x} y2={leaf.y} stroke={main ? C.ink : C.door} strokeWidth={main ? 0.07 : 0.045} />
      <path d={`M ${leaf.x} ${leaf.y} A ${w} ${w} 0 0 ${sweep} ${end.x} ${end.y}`} fill="none"
        stroke={C.door} strokeWidth={0.02} strokeDasharray={main ? undefined : "0.08 0.05"} />
      {main && (
        <path
          d={v
            ? `M ${hx - sgn * 0.75} ${hy + w / 2 - 0.22} l ${sgn * 0.35} 0.22 l ${-sgn * 0.35} 0.22 z`
            : `M ${hx + w / 2 - 0.22} ${hy - sgn * 0.75} l 0.22 ${sgn * 0.35} l 0.22 ${-sgn * 0.35} z`}
          fill={C.accent} />
      )}
    </g>
  );
}

function WindowMarkShape({ w, walls }: { w: WindowMark; walls: Wall[] }) {
  const C = React.useContext(Pal);
  const t = wallThicknessAt(w, walls);
  const v = w.orientation === "v";
  return (
    <g pointerEvents="none">
      {v ? (
        <>
          <rect x={w.x - t / 2} y={w.y} width={t} height={w.width} fill={C.room} stroke={C.wall} strokeWidth={0.02} />
          <line x1={w.x} y1={w.y} x2={w.x} y2={w.y + w.width} stroke={C.glass} strokeWidth={0.03} />
        </>
      ) : (
        <>
          <rect x={w.x} y={w.y - t / 2} width={w.width} height={t} fill={C.room} stroke={C.wall} strokeWidth={0.02} />
          <line x1={w.x} y1={w.y} x2={w.x + w.width} y2={w.y} stroke={C.glass} strokeWidth={0.03} />
        </>
      )}
    </g>
  );
}

/** Lift car in its shaft: a square with a cross, the plan convention. */
function LiftShape({ r }: { r: Room }) {
  const C = React.useContext(Pal);
  const s = Math.min(r.w, r.h) - 0.4;
  const x = r.x + (r.w - s) / 2;
  const y = r.y + (r.h - s) / 2;
  return (
    <g fill="none" stroke={C.inkSoft} strokeWidth={0.04}>
      <rect x={x} y={y} width={s} height={s} />
      <path d={`M ${x} ${y} L ${x + s} ${y + s} M ${x + s} ${y} L ${x} ${y + s}`} />
    </g>
  );
}

function StairShape({ r }: { r: Room }) {
  const C = React.useContext(Pal);
  // Dog-leg stair: two flights along the long side, a landing at the far end.
  const alongY = r.h >= r.w;
  const len = alongY ? r.h : r.w;
  const wid = alongY ? r.w : r.h;
  const landing = Math.min(wid / 2, len * 0.3);
  const run = len - landing;
  const treads = Math.max(6, Math.round(run / 0.28));
  const lines: React.ReactNode[] = [];
  for (let i = 1; i < treads; i++) {
    const p = (run * i) / treads;
    lines.push(alongY
      ? <line key={i} x1={r.x} y1={r.y + landing + p} x2={r.x + r.w} y2={r.y + landing + p} />
      : <line key={i} x1={r.x + landing + p} y1={r.y} x2={r.x + landing + p} y2={r.y + r.h} />);
  }
  const mid = alongY
    ? <line x1={r.x + r.w / 2} y1={r.y + landing} x2={r.x + r.w / 2} y2={r.y + r.h} strokeWidth={0.04} />
    : <line x1={r.x + landing} y1={r.y + r.h / 2} x2={r.x + r.w} y2={r.y + r.h / 2} strokeWidth={0.04} />;
  const arrow = alongY
    ? `M ${r.x + r.w * 0.25} ${r.y + r.h - 0.3} L ${r.x + r.w * 0.25} ${r.y + landing + 0.2}`
    : `M ${r.x + r.w - 0.3} ${r.y + r.h * 0.25} L ${r.x + landing + 0.2} ${r.y + r.h * 0.25}`;
  return (
    <g stroke={C.inkFaint} strokeWidth={0.02}>
      {lines}
      {mid}
      <path d={arrow} stroke={C.inkSoft} strokeWidth={0.035} markerEnd="" />
      <text x={alongY ? r.x + r.w * 0.25 : r.x + r.w - 0.55} y={alongY ? r.y + r.h - 0.15 : r.y + r.h * 0.25 + 0.12}
        textAnchor="middle" stroke="none" fill={C.inkSoft} style={{ fontSize: 0.22, fontWeight: 700 }}>UP</text>
    </g>
  );
}

function CarShape({ x, y, w, h, tone = 0 }: { x: number; y: number; w: number; h: number; tone?: number }) {
  const C = React.useContext(Pal);
  const vertical = h >= w;
  const cw = vertical ? Math.min(w * 0.72, 1.9) : Math.min(h * 0.72, 1.9);
  const cl = vertical ? Math.min(h * 0.82, 4.5) : Math.min(w * 0.82, 4.5);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const bw = vertical ? cw : cl;
  const bh = vertical ? cl : cw;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="url(#fp-paving)" stroke={C.pavingLine} strokeWidth={0.03} />
      <rect x={cx - bw / 2} y={cy - bh / 2} width={bw} height={bh} rx={0.45} fill={C.colour ? C.cars[tone % C.cars.length] : C.room} stroke={C.furniture} strokeWidth={0.04} />
      {vertical ? (
        <>
          <rect x={cx - bw / 2 + 0.2} y={cy - bh / 2 + bh * 0.24} width={bw - 0.4} height={bh * 0.18} rx={0.12} fill={C.pavingLine} />
          <rect x={cx - bw / 2 + 0.2} y={cy + bh * 0.12} width={bw - 0.4} height={bh * 0.14} rx={0.12} fill={C.pavingLine} />
        </>
      ) : (
        <>
          <rect x={cx - bw / 2 + bw * 0.24} y={cy - bh / 2 + 0.2} width={bw * 0.18} height={bh - 0.4} rx={0.12} fill={C.pavingLine} />
          <rect x={cx + bw * 0.12} y={cy - bh / 2 + 0.2} width={bw * 0.14} height={bh - 0.4} rx={0.12} fill={C.pavingLine} />
        </>
      )}
    </g>
  );
}

function GardenShape({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const C = React.useContext(Pal);
  // A few trees along the edges; deterministic positions.
  const trees: [number, number, number][] = [];
  const step = 4;
  for (let tx = x + 1.2; tx < x + w - 1; tx += step) {
    trees.push([tx, y + 1.1, 0.9]);
    if (h > 5) trees.push([tx + step / 2, y + h - 1.1, 0.8]);
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={0.3} fill="url(#fp-grass)" stroke={C.grassInk} strokeWidth={0.03} />
      {trees.slice(0, 14).map(([tx, ty, r], i) => (
        <g key={i}>
          <circle cx={tx} cy={ty} r={r} fill={C.grass} stroke={C.grassInk} strokeWidth={0.03} />
          <circle cx={tx} cy={ty} r={0.08} fill={C.grassInk} />
        </g>
      ))}
    </g>
  );
}

function PoolShape({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const C = React.useContext(Pal);
  return (
    <g>
      <rect x={x - 0.6} y={y - 0.6} width={w + 1.2} height={h + 1.2} rx={0.2} fill="url(#fp-paving)" stroke={C.pavingLine} strokeWidth={0.03} />
      <rect x={x} y={y} width={w} height={h} rx={0.35} fill={C.water} stroke={C.waterInk} strokeWidth={0.08} />
      <path d={`M ${x + w * 0.2} ${y + h * 0.45} q ${w * 0.08} -0.15 ${w * 0.16} 0 t ${w * 0.16} 0`} fill="none" stroke={C.waterInk} strokeWidth={0.03} opacity={0.6} />
    </g>
  );
}

function DimLine({ x1, y1, x2, y2, label, vertical, s, strong }: { x1: number; y1: number; x2: number; y2: number; label: string; vertical?: boolean; s: number; strong?: boolean }) {
  const C = React.useContext(Pal);
  const t = 0.12;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const ext = 0.25; // extension past the ticks
  return (
    <g stroke={C.inkSoft} strokeWidth={strong ? 0.03 : 0.02} pointerEvents="none">
      {vertical ? (
        <>
          <line x1={x1} y1={y1 - ext} x2={x2} y2={y2 + ext} />
          <line x1={x1 - t} y1={y1 + t} x2={x1 + t} y2={y1 - t} strokeWidth={0.04} />
          <line x1={x2 - t} y1={y2 + t} x2={x2 + t} y2={y2 - t} strokeWidth={0.04} />
        </>
      ) : (
        <>
          <line x1={x1 - ext} y1={y1} x2={x2 + ext} y2={y2} />
          <line x1={x1 - t} y1={y1 + t} x2={x1 + t} y2={y1 - t} strokeWidth={0.04} />
          <line x1={x2 - t} y1={y2 + t} x2={x2 + t} y2={y2 - t} strokeWidth={0.04} />
        </>
      )}
      {label && (
        <text x={mx} y={my - 0.14} textAnchor="middle" stroke="none" fill={strong ? C.ink : C.inkSoft}
          transform={vertical ? `rotate(-90 ${mx} ${my})` : undefined}
          style={{ fontSize: Math.min(strong ? 0.3 : 0.24, 0.3 * s), fontWeight: strong ? 600 : 500, fontFamily: "var(--font-mono, ui-monospace)" }}>
          {label}
        </text>
      )}
    </g>
  );
}

/** Room boundaries along the top and left outer walls, as [start, end] segments. */
function dimensionChains(rooms: Room[], fp: { x: number; y: number; w: number; h: number }) {
  const e = 0.02;
  const cuts = (vals: number[], lo: number, hi: number) => {
    const xs = [...new Set([lo, hi, ...vals].map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
    return xs.slice(1).map((b, i) => [xs[i], b] as [number, number]).filter(([a, b]) => b - a > 0.3);
  };
  // Measure along the first row of indoor rooms (a full-width sit-out would hide the chain).
  const indoor = rooms.filter((r) => !OPEN_ROOMS.includes(r.type));
  const firstRow = indoor.length ? Math.min(...indoor.map((r) => r.y)) : fp.y;
  const top = indoor.filter((r) => Math.abs(r.y - firstRow) < e).flatMap((r) => [r.x, r.x + r.w]);
  const left = rooms.filter((r) => Math.abs(r.x - fp.x) < e).flatMap((r) => [r.y, r.y + r.h]);
  return { top: cuts(top, fp.x, fp.x + fp.w), left: cuts(left, fp.y, fp.y + fp.h) };
}

export function TitleBlock({ x, y, w, h, s, meta, floorName, drawing }: { x: number; y: number; w: number; h: number; s: number; meta?: SheetMeta; floorName: string; drawing?: string }) {
  const C = React.useContext(Pal);
  const pad = 0.25 * s;
  const top = y + 0.15 * s;
  const cellH = h - pad - 0.15 * s;
  const cols = [0.42, 0.24, 0.17, 0.17];
  const label = { fontSize: 0.22 * s, fontWeight: 600, letterSpacing: 0.04 * s, fontFamily: "var(--font-mono, ui-monospace)" } as const;
  const value = { fontSize: 0.4 * s, fontWeight: 600 } as const;
  const cells: [string, string][] = [
    ["Project", meta?.project ?? "Residence"],
    ["Drawing", drawing ?? `${floorName} plan`],
    ["Scale", "1:100"],
    ["Date", meta?.date ?? ""],
  ];
  const inner = w - 2 * pad;
  const starts = cols.map((_, i) => x + pad + inner * cols.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <g pointerEvents="none">
      <rect x={x + pad} y={top} width={inner} height={cellH} fill={C.sheet} stroke={C.ink} strokeWidth={0.04 * s} />
      {cells.map(([k, v], i) => (
        <g key={k}>
          {i > 0 && <line x1={starts[i]} y1={top} x2={starts[i]} y2={top + cellH} stroke={C.ink} strokeWidth={0.03 * s} />}
          <text x={starts[i] + 0.3 * s} y={top + 0.55 * s} fill={C.inkSoft} style={label}>{k.toUpperCase()}</text>
          <text x={starts[i] + 0.3 * s} y={top + 1.3 * s} fill={C.ink}
            style={i === 0 ? { ...value, fontSize: 0.46 * s, fontWeight: 700 } : value}>{v}</text>
          {i === 0 && meta?.subtitle && (
            <text x={starts[i] + 0.3 * s} y={top + 1.85 * s} fill={C.inkSoft} style={{ fontSize: 0.26 * s, fontWeight: 500 }}>
              {meta.subtitle}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

function labelFor(t: RoomType): string {
  const map: Partial<Record<RoomType, string>> = {
    master_bedroom: "Master Bedroom",
    toilet: "Powder Room",
    bathroom: "Bathroom",
    sitout: "Sit-out",
    dress: "Dress",
    corridor: "Passage",
    stair: "Staircase",
  };
  return map[t] ?? t.charAt(0).toUpperCase() + t.slice(1).replace("_", " ");
}
