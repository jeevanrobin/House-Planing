"""
Server-side plot geometry — validates and recomputes plot metrics from the
stored GeoJSON boundary so the backend is the source of truth (never trusts
client-sent areas). Mirrors apps/web/src/lib/geo/plot-geometry.ts.
"""
from __future__ import annotations

import math

EARTH_R = 6378137.0
SQM_TO_SQFT = 10.7639104167
D2R = math.pi / 180
OCT = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

LatLng = tuple[float, float]  # (lat, lng)


def ring_from_geojson(boundary: dict) -> list[LatLng]:
    coords = (boundary.get("coordinates") or [[]])[0]
    pts = [(lat, lng) for lng, lat in coords]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return pts


def _centroid(pts: list[LatLng]) -> LatLng:
    n = len(pts) or 1
    return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)


def _local(pts: list[LatLng], origin: LatLng) -> list[tuple[float, float]]:
    cos_lat = math.cos(origin[0] * D2R)
    return [(
        (p[1] - origin[1]) * D2R * cos_lat * EARTH_R,  # east
        (p[0] - origin[0]) * D2R * EARTH_R,            # north
    ) for p in pts]


def area_sqm(pts: list[LatLng]) -> float:
    if len(pts) < 3:
        return 0.0
    loc = _local(pts, _centroid(pts))
    s = 0.0
    for i in range(len(loc)):
        ax, ay = loc[i]
        bx, by = loc[(i + 1) % len(loc)]
        s += ax * by - bx * ay
    return abs(s) / 2


def perimeter_m(pts: list[LatLng]) -> float:
    if len(pts) < 2:
        return 0.0
    loc = _local(pts, _centroid(pts))
    per = 0.0
    for i in range(len(loc)):
        ax, ay = loc[i]
        bx, by = loc[(i + 1) % len(loc)]
        per += math.hypot(bx - ax, by - ay)
    return per


def principal_dims(pts: list[LatLng]) -> tuple[float, float, float]:
    loc = _local(pts, _centroid(pts))
    n = len(loc)
    if n < 2:
        return 0.0, 0.0, 0.0
    mx = sum(p[0] for p in loc) / n
    my = sum(p[1] for p in loc) / n
    sxx = sum((p[0] - mx) ** 2 for p in loc) / n
    syy = sum((p[1] - my) ** 2 for p in loc) / n
    sxy = sum((p[0] - mx) * (p[1] - my) for p in loc) / n
    tr = sxx + syy
    disc = math.sqrt(max(0.0, tr * tr / 4 - (sxx * syy - sxy * sxy)))
    l1 = tr / 2 + disc
    if abs(sxy) > 1e-9:
        vx, vy = l1 - syy, sxy
    else:
        # Axis-aligned: major axis follows the larger variance.
        vx, vy = (1.0, 0.0) if sxx >= syy else (0.0, 1.0)
    mag = math.hypot(vx, vy) or 1.0
    vx, vy = vx / mag, vy / mag
    px, py = -vy, vx  # minor axis
    maj = [(p[0] - mx) * vx + (p[1] - my) * vy for p in loc]
    minr = [(p[0] - mx) * px + (p[1] - my) * py for p in loc]
    if vy < 0:
        vx, vy = -vx, -vy
    bearing = (math.degrees(math.atan2(vx, vy)) + 360) % 360
    return max(maj) - min(maj), max(minr) - min(minr), bearing


def bearing_to_facing(bearing: float) -> str:
    return OCT[round(((bearing % 360) + 360) % 360 / 45) % 8]


def _seg_cross(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _intersect(a1, a2, b1, b2) -> bool:
    d1 = _seg_cross(b1, b2, a1)
    d2 = _seg_cross(b1, b2, a2)
    d3 = _seg_cross(a1, a2, b1)
    d4 = _seg_cross(a1, a2, b2)
    return (d1 > 0) != (d2 > 0) and (d3 > 0) != (d4 > 0)


def is_self_intersecting(pts: list[LatLng]) -> bool:
    loc = _local(pts, _centroid(pts))
    n = len(loc)
    if n < 4:
        return False
    for i in range(n):
        a1, a2 = loc[i], loc[(i + 1) % n]
        for j in range(i + 1, n):
            if j == i or (j + 1) % n == i or (i + 1) % n == j:
                continue
            if _intersect(a1, a2, loc[j], loc[(j + 1) % n]):
                return True
    return False


def validate(pts: list[LatLng]) -> str | None:
    if len(pts) < 3:
        return "A plot needs at least 3 corner points."
    if is_self_intersecting(pts):
        return "The boundary crosses itself."
    if area_sqm(pts) < 1:
        return "Plot area is too small or the shape is empty."
    return None


def compute(boundary: dict) -> dict:
    """Validate + compute authoritative metrics from a GeoJSON polygon."""
    pts = ring_from_geojson(boundary)
    err = validate(pts)
    if err:
        raise ValueError(err)
    a = area_sqm(pts)
    length, width, bearing = principal_dims(pts)
    c = _centroid(pts)
    return {
        "area_sqm": round(a, 2),
        "area_sqft": round(a * SQM_TO_SQFT, 2),
        "perimeter_m": round(perimeter_m(pts), 2),
        "length_m": round(length, 2),
        "width_m": round(width, 2),
        "facing": bearing_to_facing(bearing),
        "latitude": c[0],
        "longitude": c[1],
    }
