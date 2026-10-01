"""
Pure computational geometry on 2D polygons (vertices in local metres).
No external dependencies.
"""
from __future__ import annotations
import math
from dataclasses import dataclass

@dataclass
class Rect:
    x: float
    y: float
    w: float
    h: float

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}

@dataclass
class PolyEdge:
    x1: float
    y1: float
    x2: float
    y2: float
    length: float
    orientation: str  # "h" or "v"

    def to_dict(self) -> dict:
        return {
            "x1": self.x1,
            "y1": self.y1,
            "x2": self.x2,
            "y2": self.y2,
            "length": self.length,
            "orientation": self.orientation,
        }

def signed_area(poly: list[tuple[float, float]]) -> float:
    """Signed area (positive = counter-clockwise)."""
    if len(poly) < 3:
        return 0.0
    s = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s / 2.0

def polygon_area(poly: list[tuple[float, float]]) -> float:
    return abs(signed_area(poly))

def ensure_ccw(poly: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Ensure vertices are in counter-clockwise order."""
    return poly if signed_area(poly) >= 0 else list(reversed(poly))

def polygon_centroid(poly: list[tuple[float, float]]) -> tuple[float, float]:
    a6 = signed_area(poly) * 6.0 or 1.0
    cx = 0.0
    cy = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    return cx / a6, cy / a6

def polygon_bbox(poly: list[tuple[float, float]]) -> Rect:
    if not poly:
        return Rect(0.0, 0.0, 0.0, 0.0)
    min_x = min(p[0] for p in poly)
    max_x = max(p[0] for p in poly)
    min_y = min(p[1] for p in poly)
    max_y = max(p[1] for p in poly)
    return Rect(min_x, min_y, max_x - min_x, max_y - min_y)

def rect_to_polygon(r: Rect) -> list[tuple[float, float]]:
    return [
        (r.x, r.y),
        (r.x + r.w, r.y),
        (r.x + r.w, r.y + r.h),
        (r.x, r.y + r.h)
    ]

def is_convex(poly: list[tuple[float, float]]) -> bool:
    n = len(poly)
    if n < 3:
        return False
    sign = 0
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        x3, y3 = poly[(i + 2) % n]
        cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2)
        if abs(cross) < 1e-9:
            continue
        curr_sign = 1 if cross > 0 else -1
        if sign == 0:
            sign = curr_sign
        elif curr_sign != sign:
            return False
    return True

def point_in_polygon(pt: tuple[float, float], poly: list[tuple[float, float]]) -> bool:
    inside = False
    px, py = pt
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi or 1) + xi):
            inside = not inside
        j = i
    return inside

def inset_polygon(poly: list[tuple[float, float]], dist: float) -> list[tuple[float, float]]:
    """
    Shrink a polygon inward by `dist` metres on all sides.
    Uses parallel-edge offset with miter joins.
    Falls back to a smaller inset if the result degenerates.
    """
    ccw = ensure_ccw(poly)
    n = len(ccw)
    if n < 3 or dist <= 0:
        return ccw

    edges: list[dict] = []
    for i in range(n):
        x1, y1 = ccw[i]
        x2, y2 = ccw[(i + 1) % n]
        dx = x2 - x1
        dy = y2 - y1
        length = math.hypot(dx, dy) or 1.0
        # Inward normal for CCW polygon: rotate edge 90° counter-clockwise -> (-dy, dx).
        nx = -dy / length
        ny = dx / length
        # Offset line: nx*x + ny*y = d
        edges.append({"nx": nx, "ny": ny, "d": nx * x1 + ny * y1 + dist})

    result: list[tuple[float, float]] = []
    for i in range(n):
        e1 = edges[i]
        e2 = edges[(i + 1) % n]
        det = e1["nx"] * e2["ny"] - e1["ny"] * e2["nx"]
        if abs(det) < 1e-12:
            continue  # parallel edges - skip
        x = (e1["d"] * e2["ny"] - e2["d"] * e1["ny"]) / det
        y = (e1["nx"] * e2["d"] - e2["nx"] * e1["d"]) / det
        result.append((x, y))

    if len(result) < 3 or polygon_area(result) < 1.0:
        if dist > 0.3:
            return inset_polygon(poly, dist * 0.5)
        return ccw  # use original polygon

    return result

def clip_polygon(subject: list[tuple[float, float]], clip: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(subject) < 3 or len(clip) < 3:
        return []
    output = list(subject)

    for i in range(len(clip)):
        if not output:
            break
        input_pts = output
        output = []
        ex1, ey1 = clip[i]
        ex2, ey2 = clip[(i + 1) % len(clip)]

        for j in range(len(input_pts)):
            current = input_pts[j]
            prev = input_pts[(j - 1) % len(input_pts)]
            c_inside = _cross_2d(ex1, ey1, ex2, ey2, current[0], current[1]) >= -1e-9
            p_inside = _cross_2d(ex1, ey1, ex2, ey2, prev[0], prev[1]) >= -1e-9

            if c_inside:
                if not p_inside:
                    output.append(_intersect_lines(prev, current, (ex1, ey1), (ex2, ey2)))
                output.append(current)
            elif p_inside:
                output.append(_intersect_lines(prev, current, (ex1, ey1), (ex2, ey2)))
    return output

def _cross_2d(ex1: float, ey1: float, ex2: float, ey2: float, px: float, py: float) -> float:
    return (ex2 - ex1) * (py - ey1) - (ey2 - ey1) * (px - ex1)

def _intersect_lines(
    a: tuple[float, float], b: tuple[float, float],
    c: tuple[float, float], d: tuple[float, float],
) -> tuple[float, float]:
    x1, y1 = a
    x2, y2 = b
    x3, y3 = c
    x4, y4 = d
    denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denom) < 1e-12:
        return a
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
    return x1 + t * (x2 - x1), y1 + t * (y2 - y1)

def subdivide_polygon(
    poly: list[tuple[float, float]],
    weights: list[float],
    force_axis: str | None = None,
) -> list[list[tuple[float, float]]]:
    if len(weights) <= 1 or len(poly) < 3:
        return [poly]

    total = sum(weights) or 1.0
    bbox = polygon_bbox(poly)
    axis = force_axis or ("y" if bbox.h >= bbox.w else "x")

    results: list[list[tuple[float, float]]] = []
    remaining = poly

    for i in range(len(weights) - 1):
        remaining_weight = sum(weights[i:])
        frac = weights[i] / remaining_weight

        r_bbox = polygon_bbox(remaining)
        if axis == "y":
            cut_pos = r_bbox.y + r_bbox.h * frac
        else:
            cut_pos = r_bbox.x + r_bbox.w * frac

        piece, rest = split_polygon_by_line(remaining, axis, cut_pos)
        if len(piece) >= 3:
            results.append(piece)
        else:
            results.append(remaining)
        if len(rest) >= 3:
            remaining = rest
        else:
            break

    if len(remaining) >= 3:
        results.append(remaining)

    while len(results) < len(weights):
        results.append(results[-1])

    return results

def split_polygon_by_line(
    poly: list[tuple[float, float]],
    axis: str,
    pos: float,
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    bbox = polygon_bbox(poly)
    margin = max(bbox.w, bbox.h) + 10.0

    if axis == "y":
        clip_a = [
            (bbox.x - margin, bbox.y - margin),
            (bbox.x + bbox.w + margin, bbox.y - margin),
            (bbox.x + bbox.w + margin, pos),
            (bbox.x - margin, pos)
        ]
        clip_b = [
            (bbox.x - margin, pos),
            (bbox.x + bbox.w + margin, pos),
            (bbox.x + bbox.w + margin, bbox.y + bbox.h + margin),
            (bbox.x - margin, bbox.y + bbox.h + margin)
        ]
    else:
        clip_a = [
            (bbox.x - margin, bbox.y - margin),
            (pos, bbox.y - margin),
            (pos, bbox.y + bbox.h + margin),
            (bbox.x - margin, bbox.y + bbox.h + margin)
        ]
        clip_b = [
            (pos, bbox.y - margin),
            (bbox.x + bbox.w + margin, bbox.y - margin),
            (bbox.x + bbox.w + margin, bbox.y + bbox.h + margin),
            (pos, bbox.y + bbox.h + margin)
        ]

    return clip_polygon(poly, clip_a), clip_polygon(poly, clip_b)

def polygon_edges(poly: list[tuple[float, float]]) -> list[PolyEdge]:
    edges: list[PolyEdge] = []
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        length = math.hypot(x2 - x1, y2 - y1)
        orientation = "h" if abs(x2 - x1) >= abs(y2 - y1) else "v"
        edges.append(PolyEdge(x1, y1, x2, y2, length, orientation))
    return edges

def point_on_polygon_edge(
    pt: tuple[float, float],
    poly: list[tuple[float, float]],
    tol: float = 0.08,
) -> bool:
    px, py = pt
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        length = math.hypot(x2 - x1, y2 - y1)
        if length < 1e-9:
            continue
        t = max(0.0, min(1.0, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / (length * length)))
        dx = px - (x1 + t * (x2 - x1))
        dy = py - (y1 + t * (y2 - y1))
        if math.hypot(dx, dy) < tol:
            return True
    return False

def edge_on_boundary(
    x1: float, y1: float, x2: float, y2: float,
    boundary: list[tuple[float, float]],
    tol: float = 0.08,
) -> bool:
    mid = ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
    return (point_on_polygon_edge((x1, y1), boundary, tol) and
            point_on_polygon_edge((x2, y2), boundary, tol) and
            point_on_polygon_edge(mid, boundary, tol))
