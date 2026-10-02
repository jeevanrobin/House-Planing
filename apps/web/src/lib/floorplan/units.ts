/** Indian drawing conventions: feet and inches, sq ft, and plan titles. */
import type { Facing, Requirements } from "./types";

const FT = 0.3048;
const SQFT = 10.7639;

/** 3.45 m → 11′4″ */
export function ftIn(m: number): string {
  const totalIn = Math.round(m * 39.3701);
  return `${Math.floor(totalIn / 12)}′${totalIn % 12}″`;
}

/** Whole feet when the size is a round number of feet (30′), else feet and inches. */
function plotFt(m: number): string {
  const ft = m / FT;
  return Math.abs(ft - Math.round(ft)) < 0.05 ? `${Math.round(ft)}′` : ftIn(m);
}

export const sqft = (m2: number) => Math.round(m2 * SQFT).toLocaleString("en-IN");

const FACING_NAME: Record<Facing, string> = {
  N: "North", NE: "North-east", E: "East", SE: "South-east", S: "South", SW: "South-west", W: "West", NW: "North-west",
};

/** "30′×50′ East-facing house" (rectangular plots) or "East-facing house" (map-drawn plots). */
export function planTitle(req: Requirements): string {
  const size = req.plotPolygon ? "" : `${plotFt(req.plotWidth)}×${plotFt(req.plotDepth)} `;
  return `${size}${FACING_NAME[req.facing]}-facing house`;
}

/** "3 BHK · G+1 · 1,500 sq ft plot" */
export function planSubtitle(req: Requirements, plotArea: number): string {
  const floors = req.floors > 1 ? `G+${req.floors - 1}` : "Ground floor only";
  return `${req.bedrooms} BHK · ${floors} · ${sqft(plotArea)} sq ft plot`;
}
