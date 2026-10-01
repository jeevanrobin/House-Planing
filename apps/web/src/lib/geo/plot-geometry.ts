/**
 * Pure plot geometry — no Google Maps dependency, fully unit-testable.
 * Coordinates are WGS84 lat/lng; metric calcs project to a local ENU
 * (east-north-up) plane around the polygon centroid (accurate for plots).
 */
import type { Facing } from "@/lib/floorplan/types";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PlotMetrics {
  areaSqm: number;
  areaSqft: number;
  perimeterM: number;
  lengthM: number;
  widthM: number;
  facing: Facing;
  facingBearing: number; // degrees, 0 = North
  centroid: LatLng;
  vertices: number;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

const EARTH_R = 6378137; // metres
const SQM_TO_SQFT = 10.7639104167;
const D2R = Math.PI / 180;

interface Vec {
  x: number; // east
  y: number; // north
}

export function centroidOf(points: LatLng[]): LatLng {
  const n = points.length || 1;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  };
}

/** Project lat/lng to local metres relative to an origin. */
export function toLocalMeters(points: LatLng[], origin: LatLng): Vec[] {
  const cosLat = Math.cos(origin.lat * D2R);
  return points.map((p) => ({
    x: (p.lng - origin.lng) * D2R * cosLat * EARTH_R,
    y: (p.lat - origin.lat) * D2R * EARTH_R,
  }));
}

/** Signed-area magnitude via the shoelace formula (m²). */
export function polygonAreaSqm(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const local = toLocalMeters(points, centroidOf(points));
  let sum = 0;
  for (let i = 0; i < local.length; i++) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeterM(points: LatLng[]): number {
  if (points.length < 2) return 0;
  const local = toLocalMeters(points, centroidOf(points));
  let per = 0;
  for (let i = 0; i < local.length; i++) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    per += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return per;
}

/**
 * Principal dimensions via 2×2 PCA of the vertices: length is the extent
 * along the major axis, width along the minor axis. The major-axis bearing
 * drives the facing heuristic (front/short edges face along the major axis).
 */
export function principalDimensions(points: LatLng[]): {
  lengthM: number;
  widthM: number;
  majorBearing: number;
} {
  const local = toLocalMeters(points, centroidOf(points));
  const n = local.length;
  if (n < 2) return { lengthM: 0, widthM: 0, majorBearing: 0 };

  const mx = local.reduce((s, p) => s + p.x, 0) / n;
  const my = local.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of local) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;

  // Larger eigenvalue / eigenvector of the covariance matrix.
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (sxx * syy - sxy * sxy)));
  const l1 = tr / 2 + disc;
  // Axis-aligned (sxy≈0): major axis follows the larger variance.
  let major: Vec =
    Math.abs(sxy) > 1e-9
      ? { x: l1 - syy, y: sxy }
      : sxx >= syy
        ? { x: 1, y: 0 }
        : { x: 0, y: 1 };
  const mag = Math.hypot(major.x, major.y) || 1;
  major = { x: major.x / mag, y: major.y / mag };
  const minor: Vec = { x: -major.y, y: major.x };

  let majMin = Infinity, majMax = -Infinity, minMin = Infinity, minMax = -Infinity;
  for (const p of local) {
    const dx = p.x - mx, dy = p.y - my;
    const a = dx * major.x + dy * major.y;
    const b = dx * minor.x + dy * minor.y;
    majMin = Math.min(majMin, a); majMax = Math.max(majMax, a);
    minMin = Math.min(minMin, b); minMax = Math.max(minMax, b);
  }

  // Orient the major vector to have a non-negative north component.
  const oriented = major.y >= 0 ? major : { x: -major.x, y: -major.y };
  const bearing = (Math.atan2(oriented.x, oriented.y) / D2R + 360) % 360;

  return {
    lengthM: majMax - majMin,
    widthM: minMax - minMin,
    majorBearing: bearing,
  };
}

const OCT: Facing[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function bearingToFacing(bearing: number): Facing {
  return OCT[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

/** True if any two non-adjacent edges properly intersect. */
export function isSelfIntersecting(points: LatLng[]): boolean {
  const p = toLocalMeters(points, centroidOf(points));
  const n = p.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = p[i], a2 = p[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip shared-vertex / adjacent edges.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = p[j], b2 = p[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function cross(o: Vec, a: Vec, b: Vec): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(a1: Vec, a2: Vec, b1: Vec, b2: Vec): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

export function validatePolygon(points: LatLng[]): ValidationResult {
  if (points.length < 3) return { ok: false, error: "A plot needs at least 3 corner points." };
  if (isSelfIntersecting(points)) return { ok: false, error: "The boundary crosses itself — fix the overlapping edges." };
  if (polygonAreaSqm(points) < 1) return { ok: false, error: "Plot area is too small or the shape is empty." };
  return { ok: true };
}

export function computePlotMetrics(points: LatLng[]): PlotMetrics {
  const areaSqm = polygonAreaSqm(points);
  const { lengthM, widthM, majorBearing } = principalDimensions(points);
  return {
    areaSqm,
    areaSqft: areaSqm * SQM_TO_SQFT,
    perimeterM: polygonPerimeterM(points),
    lengthM,
    widthM,
    facing: bearingToFacing(majorBearing),
    facingBearing: majorBearing,
    centroid: centroidOf(points),
    vertices: points.length,
  };
}

/** GeoJSON Polygon (lng,lat order) for storage / interchange. */
export function toGeoJSON(points: LatLng[]): {
  type: "Polygon";
  coordinates: [number, number][][];
} {
  const ring = points.map((p) => [p.lng, p.lat] as [number, number]);
  if (ring.length) ring.push(ring[0]); // close the ring
  return { type: "Polygon", coordinates: [ring] };
}

export function fromGeoJSON(geo: { coordinates: [number, number][][] }): LatLng[] {
  const ring = geo.coordinates?.[0] ?? [];
  const pts = ring.map(([lng, lat]) => ({ lat, lng }));
  // Drop the duplicated closing vertex if present.
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (a.lat === b.lat && a.lng === b.lng) pts.pop();
  }
  return pts;
}
