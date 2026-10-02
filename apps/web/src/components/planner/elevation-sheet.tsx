"use client";

import * as React from "react";
import { buildElevation, PLINTH } from "@/lib/floorplan/elevation";
import type { RoofStyle } from "@/lib/floorplan/model3d";
import type { PlanResult } from "@/lib/floorplan/types";
import { LIGHT, Pal, TitleBlock, type SheetMeta } from "./floor-plan-canvas";

/** Facade colours: warm plaster, teak, stone, clay tiles, glass. */
const F = {
  sky: "#EAF2F8",
  skyTop: "#CFE2F1",
  ground: "#C9D7A8",
  earth: "#A9B98C",
  wall: "#F2EBDD",
  wallDeep: "#E2D7C2",
  wallLine: "#BDB29E",
  wood: "#A8693F",
  woodDark: "#7A4A2B",
  stone: "#9D968A",
  slab: "#E8E2D6",
  frame: "#3E3D3A",
  glass: "#9CC7E4",
  glassDark: "#6FA6CC",
  rail: "#B9D4E6",
  tile: "#B4563C",
  tileLine: "#8E3F2B",
  ink: "#2A2925",
  inkSoft: "#5F5B52",
  tree: "#6FA85A",
  treeDark: "#4D7D3B",
  trunk: "#6E5038",
  compound: "#E4DED2",
};

/**
 * Front elevation sheet: the road-facing facade drawn to scale from the
 * plan, with level marks and the title block.
 */
export function ElevationSheet({ plan, roofStyle = "flat", meta }: { plan: PlanResult; roofStyle?: RoofStyle; meta?: SheetMeta }) {
  const el = React.useMemo(() => buildElevation(plan, roofStyle), [plan, roofStyle]);
  // Drawing frame: x along the road, Y = -height (SVG y grows down).
  const margin = 3;
  const x0 = Math.min(el.plot.x0, el.x0) - margin;
  const x1 = Math.max(el.plot.x1, el.x1) + margin + 3.5; // room for level marks
  const w = x1 - x0;
  const s = Math.max(w, el.top + 4) / 30;
  const titleH = 2.6 * s;
  const yTop = -(el.top + 2.5);
  const yBottom = 1.6;
  const vb = { x: x0, y: yTop, w, h: yBottom - yTop + titleH };
  const Y = (h: number) => -h;
  const fs = 0.34 * s;
  const deep = (d: number) => (d > 0.3 ? F.wallDeep : F.wall);
  const trad = el.style === "traditional";

  // Trees beside the house where the plot leaves room.
  const trees: [number, number][] = [];
  if (el.x0 - el.plot.x0 > 2.2) trees.push([el.plot.x0 + (el.x0 - el.plot.x0) / 2, 3.2]);
  if (el.plot.x1 - el.x1 > 2.2) trees.push([el.x1 + (el.plot.x1 - el.x1) / 2, 3.6]);

  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="h-auto w-full rounded-lg border shadow-sheet"
      role="img" aria-label="Front elevation" style={{ background: "#FBFAF6" }}>
      <defs>
        <linearGradient id="el-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={F.skyTop} />
          <stop offset="1" stopColor={F.sky} />
        </linearGradient>
        <linearGradient id="el-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={F.glass} />
          <stop offset="1" stopColor={F.glassDark} />
        </linearGradient>
        <pattern id="el-slats" width={0.12} height={1} patternUnits="userSpaceOnUse">
          <rect width={0.12} height={1} fill={F.wood} />
          <rect width={0.025} height={1} fill={F.woodDark} />
        </pattern>
        <pattern id="el-tiles" width={0.5} height={0.22} patternUnits="userSpaceOnUse">
          <rect width={0.5} height={0.22} fill={F.tile} />
          <path d="M 0 0.21 L 0.5 0.21 M 0.25 0 L 0.25 0.21" stroke={F.tileLine} strokeWidth={0.025} />
        </pattern>
      </defs>
      <Pal.Provider value={LIGHT}>
        {/* Sky and ground */}
        <rect x={vb.x} y={yTop} width={w} height={-yTop} fill="url(#el-sky)" />
        <rect x={vb.x} y={0} width={w} height={yBottom} fill={F.ground} />
        <line x1={vb.x} y1={0} x2={vb.x + w} y2={0} stroke={F.earth} strokeWidth={0.06} />

        {trees.map(([tx, th], i) => (
          <g key={i}>
            <rect x={tx - 0.12} y={Y(th * 0.55)} width={0.24} height={th * 0.55} fill={F.trunk} />
            <circle cx={tx} cy={Y(th * 0.75)} r={th * 0.32} fill={F.tree} />
            <circle cx={tx - th * 0.18} cy={Y(th * 0.62)} r={th * 0.24} fill={F.treeDark} opacity={0.6} />
          </g>
        ))}

        {/* Facade, back to front */}
        {[...el.blocks].sort((a, b) => b.depth - a.depth).map((b, i) => (
          <rect key={`b${i}`} x={b.x0} y={Y(b.h1)} width={b.x1 - b.x0} height={b.h1 - b.h0}
            fill={b.clad ? "url(#el-slats)" : deep(b.depth)} stroke={F.wallLine} strokeWidth={0.03} />
        ))}
        {/* Plinth */}
        {(() => {
          const g = el.blocks.filter((b) => b.floor === 0);
          if (!g.length) return null;
          const a = Math.min(...g.map((b) => b.x0), ...el.railings.filter((r) => r.h0 < PLINTH + 0.01).map((r) => r.x0));
          const z = Math.max(...g.map((b) => b.x1), ...el.railings.filter((r) => r.h0 < PLINTH + 0.01).map((r) => r.x1));
          return <rect x={a} y={Y(PLINTH)} width={z - a} height={PLINTH} fill={F.stone} />;
        })()}

        {/* Openings */}
        {el.openings.map((o, i) => o.kind === "window" ? (
          <g key={`o${i}`}>
            <rect x={o.x0} y={Y(o.h1)} width={o.x1 - o.x0} height={o.h1 - o.h0} fill="url(#el-glass)" stroke={F.frame} strokeWidth={0.06} />
            <line x1={(o.x0 + o.x1) / 2} y1={Y(o.h1)} x2={(o.x0 + o.x1) / 2} y2={Y(o.h0)} stroke={F.frame} strokeWidth={0.04} />
            <line x1={o.x0} y1={Y(o.h1 - 0.35)} x2={o.x1} y2={Y(o.h1 - 0.35)} stroke={F.frame} strokeWidth={0.03} />
          </g>
        ) : (
          <g key={`o${i}`}>
            <rect x={o.x0} y={Y(o.h1)} width={o.x1 - o.x0} height={o.h1 - o.h0}
              fill={o.kind === "main" ? F.woodDark : F.wood} stroke={F.frame} strokeWidth={0.06} />
            {o.kind === "main" && (
              <>
                <rect x={o.x0 + 0.12} y={Y(o.h1 - 0.15)} width={o.x1 - o.x0 - 0.24} height={(o.h1 - o.h0) * 0.42} fill="none" stroke={F.wood} strokeWidth={0.04} />
                <rect x={o.x0 + 0.12} y={Y(o.h0 + (o.h1 - o.h0) * 0.48)} width={o.x1 - o.x0 - 0.24} height={(o.h1 - o.h0) * 0.42} fill="none" stroke={F.wood} strokeWidth={0.04} />
                <circle cx={o.x1 - 0.16} cy={Y(o.h0 + 1.0)} r={0.035} fill="#D9B36A" />
              </>
            )}
          </g>
        ))}

        {/* Sunshades and slab edges */}
        {el.chajjas.map((c, i) => (
          <rect key={`c${i}`} x={c.x0} y={Y(c.h + 0.08)} width={c.x1 - c.x0} height={0.08} fill={F.slab} stroke={F.wallLine} strokeWidth={0.02} />
        ))}
        {el.slabs.map((sl, i) => (
          <rect key={`s${i}`} x={sl.x0 - 0.15} y={Y(sl.h + 0.2)} width={sl.x1 - sl.x0 + 0.3} height={0.2} fill={F.slab} stroke={F.wallLine} strokeWidth={0.025} />
        ))}

        {/* Pillars and railings */}
        {el.pillars.map((p, i) => (
          <g key={`p${i}`}>
            <rect x={p.x - 0.14} y={Y(p.h1)} width={0.28} height={p.h1 - p.h0} fill={trad ? F.wood : F.wall} stroke={trad ? F.woodDark : F.wallLine} strokeWidth={0.03} />
            {trad && <rect x={p.x - 0.22} y={Y(p.h1)} width={0.44} height={0.14} fill={F.woodDark} />}
            {trad && <rect x={p.x - 0.2} y={Y(p.h0 + 0.12)} width={0.4} height={0.12} fill={F.stone} />}
          </g>
        ))}
        {el.railings.map((r, i) => trad ? (
          <g key={`r${i}`}>
            <rect x={r.x0} y={Y(r.h1)} width={r.x1 - r.x0} height={0.08} fill={F.woodDark} />
            {Array.from({ length: Math.max(2, Math.floor((r.x1 - r.x0) / 0.18)) }, (_, k) => r.x0 + 0.09 + k * 0.18)
              .filter((x) => x < r.x1).map((x, k) => (
                <rect key={k} x={x - 0.025} y={Y(r.h1 - 0.08)} width={0.05} height={r.h1 - r.h0 - 0.08} fill={F.wood} />
              ))}
          </g>
        ) : (
          <g key={`r${i}`}>
            <rect x={r.x0} y={Y(r.h1)} width={r.x1 - r.x0} height={r.h1 - r.h0} fill={F.rail} opacity={0.55} />
            <rect x={r.x0} y={Y(r.h1)} width={r.x1 - r.x0} height={0.05} fill={F.frame} />
          </g>
        ))}

        {/* Roof */}
        {el.roof.kind === "flat" ? (
          <g>
            <rect x={el.roof.x0} y={Y(el.roof.h1)} width={el.roof.x1 - el.roof.x0} height={el.roof.h1 - el.roof.h0} fill={F.wall} stroke={F.wallLine} strokeWidth={0.03} />
            <rect x={el.roof.x0 - 0.08} y={Y(el.roof.h1 + 0.08)} width={el.roof.x1 - el.roof.x0 + 0.16} height={0.1} fill={F.slab} stroke={F.wallLine} strokeWidth={0.02} />
          </g>
        ) : (
          <g>
            <polygon points={`${el.roof.eave[0]},${Y(el.roof.h0)} ${el.roof.ridge[0]},${Y(el.roof.h1)} ${el.roof.ridge[1]},${Y(el.roof.h1)} ${el.roof.eave[1]},${Y(el.roof.h0)}`}
              fill="url(#el-tiles)" stroke={F.tileLine} strokeWidth={0.05} />
            <rect x={el.roof.eave[0]} y={Y(el.roof.h0)} width={el.roof.eave[1] - el.roof.eave[0]} height={0.2} fill={F.woodDark} />
            <line x1={el.roof.ridge[0]} y1={Y(el.roof.h1)} x2={el.roof.ridge[1]} y2={Y(el.roof.h1)} stroke={F.tileLine} strokeWidth={0.12} />
          </g>
        )}

        {/* Compound wall and gate, in front */}
        <g opacity={0.92}>
          {[[el.plot.x0, el.gate.x0], [el.gate.x1, el.plot.x1]].filter(([a, b]) => b - a > 0.05).map(([a, b], i) => (
            <g key={`cw${i}`}>
              <rect x={a} y={Y(1.2)} width={b - a} height={1.2} fill={F.compound} stroke={F.wallLine} strokeWidth={0.03} />
              <rect x={a - 0.05} y={Y(1.28)} width={b - a + 0.1} height={0.08} fill={F.stone} />
            </g>
          ))}
          <rect x={el.gate.x0} y={Y(1.3)} width={el.gate.x1 - el.gate.x0} height={1.3} fill="none" stroke={F.frame} strokeWidth={0.05} />
          {Array.from({ length: Math.floor((el.gate.x1 - el.gate.x0) / 0.15) }, (_, k) => el.gate.x0 + 0.075 + k * 0.15).map((x, k) => (
            <line key={k} x1={x} y1={Y(1.3)} x2={x} y2={0} stroke={F.frame} strokeWidth={0.025} />
          ))}
        </g>

        {/* Level marks */}
        {(() => {
          const lx = Math.max(el.plot.x1, el.x1) + 0.8;
          const marks = [...el.levels.slice(1), { label: el.roof.kind === "flat" ? "Parapet top" : "Ridge", h: el.top }];
          return (
            <g>
              <line x1={lx} y1={0} x2={lx} y2={Y(el.top)} stroke={F.inkSoft} strokeWidth={0.03} />
              {marks.map((m) => (
                <g key={m.label}>
                  <path d={`M ${lx - 0.22} ${Y(m.h) - 0.22} L ${lx} ${Y(m.h)} L ${lx + 0.22} ${Y(m.h) - 0.22} Z`} fill={F.ink} />
                  <line x1={lx - 0.4} y1={Y(m.h)} x2={lx + 0.4} y2={Y(m.h)} stroke={F.ink} strokeWidth={0.03} />
                  <text x={lx + 0.5} y={Y(m.h) + fs * 0.35} fill={F.ink} style={{ fontSize: fs * 0.8, fontWeight: 600 }}>
                    +{m.h.toFixed(2)} {m.label}
                  </text>
                </g>
              ))}
            </g>
          );
        })()}
        <text x={(el.x0 + el.x1) / 2} y={0.9} textAnchor="middle" fill={F.inkSoft}
          style={{ fontSize: 0.42 * s, fontWeight: 700, letterSpacing: 0.25 * s }}>ROAD SIDE · FRONT ELEVATION</text>

        <TitleBlock x={vb.x} y={yBottom} w={vb.w} h={titleH} s={s} meta={meta} floorName="" drawing="Front elevation" />
        <rect x={vb.x + 0.25 * s} y={vb.y + 0.25 * s} width={vb.w - 0.5 * s} height={vb.h - 0.5 * s}
          fill="none" stroke={F.ink} strokeWidth={0.05 * s} />
      </Pal.Provider>
    </svg>
  );
}
