"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { polygonBBox } from "@/lib/floorplan/polygon-ops";
import { planServices, type Drainage } from "@/lib/floorplan/services";
import type { PlanResult, Requirements } from "@/lib/floorplan/types";
import { BLUEPRINT, LIGHT, PAD, Pal, TitleBlock, type SheetMeta } from "./floor-plan-canvas";

/**
 * Plumbing & drainage sheet: the site with the house outline, wet rooms,
 * soil / waste stacks, inspection chambers and the drain run to the sewer or
 * septic tank, water tanks and rainwater pipes — with a schedule of
 * quantities beside the drawing.
 */
export function ServicesSheet({ plan, req, meta, palette, drainage }: {
  plan: PlanResult;
  req: Requirements;
  meta?: SheetMeta;
  palette?: "light" | "blueprint";
  drainage?: Drainage;
}) {
  const { resolvedTheme } = useTheme();
  const C = (palette ?? (resolvedTheme === "dark" ? "blueprint" : "light")) === "blueprint" ? BLUEPRINT : LIGHT;
  const sv = React.useMemo(() => planServices(plan, req, drainage), [plan, req, drainage]);
  const bb = polygonBBox(plan.site.plot);
  const area = { x: bb.x - PAD, y: bb.y - PAD, w: bb.w + PAD * 2, h: bb.h + PAD * 2 };
  const s = Math.max(area.w, area.h) / 30;
  const panelW = 19 * s;
  const titleH = 2.6 * s;
  const vb = { x: area.x, y: area.y, w: area.w + panelW, h: Math.max(area.h, 28 * s) + titleH };
  const drawH = vb.h - titleH;

  const ground = plan.floors[0];
  const wetTypes = ["bathroom", "toilet", "kitchen", "utility"];
  const upperWet = plan.floors.slice(1).flatMap((f) => f.rooms).filter((r) => wetTypes.includes(r.type));
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(" ");
  const drainInk = "#8A5A2B";
  const fs = 0.32 * s;

  const label = (x: number, y: number, text: string, size = fs * 0.85, fill = C.ink) => (
    <text x={x} y={y} fill={fill} stroke={C.paper} strokeWidth={0.08 * s} paintOrder="stroke"
      style={{ fontSize: size, fontWeight: 600 }}>{text}</text>
  );

  // Schedule panel geometry.
  const px = area.x + area.w + 0.4 * s;
  const pw = panelW - 0.8 * s;
  const rowH = 1.45 * s;
  const T = { title: 0.8 * s, item: 0.5 * s, spec: 0.42 * s, legend: 0.46 * s, note: 0.42 * s };
  // Notes wrap to the panel width (~0.5 em per character).
  const wrap = (text: string, size: number) => {
    const max = Math.floor((pw - 0.8 * s) / (size * 0.52));
    const out: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      if ((line + " " + word).trim().length > max) { out.push(line.trim()); line = word; } else line += " " + word;
    }
    if (line.trim()) out.push(line.trim());
    return out;
  };

  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="h-auto w-full rounded-lg border shadow-sheet"
      role="img" aria-label="Plumbing and drainage plan" style={{ background: C.paper }}>
      <Pal.Provider value={C}>
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={C.paper} />

        {/* Plot, house, wet rooms */}
        <polygon points={pts(plan.site.plot)} fill={C.ground} stroke={C.plotLine} strokeWidth={0.06 * s}
          strokeDasharray={`${0.9 * s} ${0.25 * s} ${0.15 * s} ${0.25 * s}`} />
        <text x={bb.x + bb.w / 2} y={bb.y + bb.h + PAD * 0.6} textAnchor="middle" fill={C.inkFaint}
          style={{ fontSize: 0.42 * s, fontWeight: 700, letterSpacing: 0.25 * s }}>ROAD</text>
        {ground.rooms.map((r) => (
          <rect key={r.id} x={r.x} y={r.y} width={r.w} height={r.h}
            fill={wetTypes.includes(r.type) ? C.water : C.room} stroke={C.inkFaint} strokeWidth={0.03 * s} />
        ))}
        {upperWet.map((r, i) => (
          <rect key={`u${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="none"
            stroke={C.waterInk} strokeWidth={0.03 * s} strokeDasharray={`${0.15 * s} ${0.12 * s}`} />
        ))}
        {ground.footprintPolygon && (
          <polygon points={pts(ground.footprintPolygon)} fill="none" stroke={C.wall} strokeWidth={0.09 * s} />
        )}
        {ground.rooms.filter((r) => wetTypes.includes(r.type) && r.w > 1.6 && r.h > 1.2).map((r) => (
          <text key={`l${r.id}`} x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" dominantBaseline="middle"
            fill={C.inkSoft} style={{ fontSize: fs * 0.7, fontWeight: 600 }}>{r.label.toUpperCase()}</text>
        ))}

        {/* Rainwater */}
        {sv.rainRuns.map((run, i) => (
          <polyline key={`rr${i}`} points={pts(run)} fill="none" stroke={C.waterInk} strokeWidth={0.05 * s}
            strokeDasharray={`${0.08 * s} ${0.12 * s}`} />
        ))}
        {sv.rwps.map(([x, y], i) => (
          <circle key={`rw${i}`} cx={x} cy={y} r={0.12 * s} fill={C.paper} stroke={C.waterInk} strokeWidth={0.05 * s} />
        ))}

        {/* Drains and branches */}
        {sv.branches.map((b, i) => (
          <polyline key={`b${i}`} points={pts(b)} fill="none" stroke={drainInk} strokeWidth={0.04 * s} />
        ))}
        {sv.drains.map((d, i) => (
          <polyline key={`d${i}`} points={pts(d)} fill="none" stroke={drainInk} strokeWidth={0.09 * s}
            strokeDasharray={`${0.35 * s} ${0.15 * s}`} strokeLinejoin="round" />
        ))}
        {sv.drainage === "sewer" && (
          <g>
            <path d={`M ${sv.outfall[0]} ${sv.outfall[1] - 0.6 * s} l ${-0.2 * s} ${-0.3 * s} M ${sv.outfall[0]} ${sv.outfall[1] - 0.6 * s} l ${0.2 * s} ${-0.3 * s}`}
              stroke={drainInk} strokeWidth={0.06 * s} fill="none" />
            {label(sv.outfall[0] + 0.3 * s, sv.outfall[1] + 0.55 * s, "To municipal sewer", fs * 0.8, drainInk)}
          </g>
        )}

        {/* Tanks */}
        {sv.tanks.map((t) => {
          const round = t.kind === "soakpit" || t.kind === "rwh";
          const stroke = t.kind === "sump" || t.kind === "oht" || t.kind === "rwh" ? C.waterInk : drainInk;
          const cap = t.litres ? ` ${(t.litres / 1000).toFixed(1)} kL` : "";
          return (
            <g key={t.kind}>
              {round
                ? <circle cx={t.x + t.w / 2} cy={t.y + t.h / 2} r={t.w / 2} fill={C.paper} stroke={stroke} strokeWidth={0.06 * s} />
                : <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={t.kind === "oht" ? "none" : C.paper} stroke={stroke}
                    strokeWidth={0.06 * s} strokeDasharray={t.kind === "oht" ? `${0.2 * s} ${0.12 * s}` : undefined} />}
              {t.kind === "septic" && <line x1={t.x + t.w * 0.66} y1={t.y} x2={t.x + t.w * 0.66} y2={t.y + t.h} stroke={stroke} strokeWidth={0.04 * s} />}
              {label(t.x, t.y - 0.18 * s, `${t.kind === "oht" ? "OHT (terrace)" : t.label}${cap}`, fs * 0.75, stroke)}
            </g>
          );
        })}

        {/* Chambers and stacks */}
        {sv.chambers.map((c) => (
          <g key={c.id}>
            <rect x={c.x - 0.25} y={c.y - 0.25} width={0.5} height={0.5} fill={C.paper} stroke={drainInk} strokeWidth={0.06 * s} />
            {c.gully && <path d={`M ${c.x + 0.4} ${c.y - 0.2} l 0.36 0 l -0.18 0.32 z`} fill={drainInk} />}
            {label(c.x + 0.35, c.y + 0.6 * s, c.id + (c.gully ? " + GT" : ""), fs * 0.72, drainInk)}
          </g>
        ))}
        {sv.stacks.map((st) => (
          <g key={st.id}>
            <circle cx={st.x} cy={st.y} r={0.14 * s} fill={st.kind === "soil" ? C.ink : C.accent} />
            {label(st.x + 0.2 * s, st.y - 0.15 * s, st.floors.length > 1 ? `${st.id} ·${st.floors.length}F` : st.id, fs * 0.72)}
          </g>
        ))}

        {/* North arrow */}
        <g transform={`translate(${area.x + area.w - 1.3 * s} ${area.y + 1.4 * s}) scale(${s}) rotate(${plan.site.northDeg ?? 0})`}>
          <circle r={0.75} fill={C.sheet} stroke={C.inkFaint} strokeWidth={0.05} />
          <path d="M 0 -0.58 L 0.24 0.3 L 0 0.12 L -0.24 0.3 Z" fill={C.ink} />
          <text y={-0.9} textAnchor="middle" style={{ fontSize: 0.36, fontWeight: 800 }} fill={C.ink}>N</text>
        </g>

        {/* Legend + schedule */}
        <g>
          <rect x={px} y={area.y + 0.4 * s} width={pw} height={drawH - 0.8 * s} fill={C.sheet} stroke={C.ink} strokeWidth={0.04 * s} />
          <text x={px + 0.5 * s} y={area.y + 1.6 * s} fill={C.ink} style={{ fontSize: T.title, fontWeight: 700 }}>Plumbing &amp; drainage</text>
          {([
            ["soil", "Soil stack (SP), ·nF = floors served"],
            ["waste", "Waste stack (WP)"],
            ["ic", "Inspection chamber (IC) · GT gully trap"],
            ["drain", "Underground drain, 110 mm"],
            ["rwp", "Rainwater pipe (RWP)"],
            ["upper", "Wet room on an upper floor"],
          ] as const).map(([k, text], i) => {
            const y = area.y + 2.9 * s + i * 0.95 * s;
            const x = px + 0.6 * s;
            return (
              <g key={k}>
                {k === "soil" && <circle cx={x} cy={y} r={0.14 * s} fill={C.ink} />}
                {k === "waste" && <circle cx={x} cy={y} r={0.14 * s} fill={C.accent} />}
                {k === "ic" && <rect x={x - 0.2 * s} y={y - 0.2 * s} width={0.4 * s} height={0.4 * s} fill="none" stroke={drainInk} strokeWidth={0.05 * s} />}
                {k === "drain" && <line x1={x - 0.35 * s} y1={y} x2={x + 0.35 * s} y2={y} stroke={drainInk} strokeWidth={0.09 * s} strokeDasharray={`${0.2 * s} ${0.1 * s}`} />}
                {k === "rwp" && <circle cx={x} cy={y} r={0.12 * s} fill="none" stroke={C.waterInk} strokeWidth={0.05 * s} />}
                {k === "upper" && <rect x={x - 0.3 * s} y={y - 0.18 * s} width={0.6 * s} height={0.36 * s} fill="none" stroke={C.waterInk} strokeWidth={0.04 * s} strokeDasharray={`${0.1 * s} ${0.08 * s}`} />}
                <text x={x + 0.6 * s} y={y} dominantBaseline="middle" fill={C.inkSoft} style={{ fontSize: T.legend }}>{text}</text>
              </g>
            );
          })}
          {(() => {
            const top = area.y + 9.2 * s;
            const cols = [0, 0.4, 0.76].map((f) => px + 0.4 * s + f * (pw - 0.8 * s));
            return (
              <g>
                {["Item", "Specification", "Qty"].map((h, i) => (
                  <text key={h} x={cols[i]} y={top} fill={C.inkSoft}
                    style={{ fontSize: T.spec, fontWeight: 700, letterSpacing: 0.03 * s, fontFamily: "var(--font-mono, ui-monospace)" }}>{h.toUpperCase()}</text>
                ))}
                {sv.schedule.map((row, i) => {
                  const y = top + 0.5 * s + (i + 0.6) * rowH;
                  return (
                    <g key={row.item}>
                      <line x1={px + 0.3 * s} y1={y - rowH * 0.62} x2={px + pw - 0.3 * s} y2={y - rowH * 0.62} stroke={C.inkFaint} strokeWidth={0.02 * s} />
                      <text x={cols[0]} y={y} fill={C.ink} style={{ fontSize: T.item, fontWeight: 600 }}>{row.item}</text>
                      <text x={cols[1]} y={y} fill={C.inkSoft} style={{ fontSize: T.spec }}>{row.spec}</text>
                      <text x={cols[2]} y={y} fill={C.ink} style={{ fontSize: T.spec, fontWeight: 600 }}>{row.qty}</text>
                    </g>
                  );
                })}
                {sv.notes.flatMap((n) => [...wrap(`• ${n}`, T.note), ""]).map((line, i) => (
                  <text key={i} x={px + 0.4 * s} y={top + 0.5 * s + (sv.schedule.length + 0.9) * rowH + i * T.note * 1.45}
                    fill={C.inkSoft} style={{ fontSize: T.note }}>{line}</text>
                ))}
              </g>
            );
          })()}
        </g>

        <TitleBlock x={vb.x} y={vb.y + drawH} w={vb.w} h={titleH} s={s} meta={meta} floorName="Plumbing & drainage" />
        <rect x={vb.x + 0.25 * s} y={vb.y + 0.25 * s} width={vb.w - 0.5 * s} height={vb.h - 0.5 * s}
          fill="none" stroke={C.ink} strokeWidth={0.05 * s} />
      </Pal.Provider>
    </svg>
  );
}
