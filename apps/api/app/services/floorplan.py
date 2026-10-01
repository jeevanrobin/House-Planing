"""
Server-side port of the geometric floor-plan engine.
Mirrors apps/web/src/lib/floorplan. Pure-python, no external deps.

Generates actual rooms (with dimensions, doors, windows and walls) by
subdividing zone bands into adjacency clusters — bedrooms keep their
attached bathrooms — rather than emitting plain zoning rectangles.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict
from typing import Any

from app.services.polygon_ops import (
    inset_polygon,
    polygon_area,
    polygon_bbox,
    polygon_centroid,
    rect_to_polygon,
    subdivide_polygon,
    clip_polygon,
    edge_on_boundary,
    polygon_edges,
    Rect,
)

OCTANTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
IDEAL_DIRECTION = {
    "pooja": "NE", "kitchen": "SE", "master_bedroom": "SW", "bedroom": "W",
    "living": "N", "dining": "W", "bathroom": "NW", "toilet": "NW",
    "stair": "SW", "store": "SW", "office": "W", "parking": "NW",
}
ZONE_OF = {
    "living": "public", "dining": "public", "foyer": "public",
    "kitchen": "service", "store": "service", "utility": "service",
    "bathroom": "service", "toilet": "service", "parking": "service",
    "stair": "circulation", "corridor": "circulation",
    "bedroom": "private", "master_bedroom": "private", "pooja": "private",
    "office": "private", "balcony": "outdoor", "garden": "outdoor",
    "pool": "outdoor",
}
BAND_GROUPS = [["public"], ["service", "circulation"], ["private"], ["outdoor"]]
FLOOR_NAMES = ["Ground Floor", "First Floor", "Second Floor", "Third Floor", "Fourth Floor"]
SWAPPABLE = {"kitchen", "dining", "living", "pooja", "store", "utility", "office", "foyer", "toilet"}
EPS = 0.001


def _js_round(v: float) -> int:
    """JavaScript Math.round: halves round up. Python's round() rounds halves
    to even, which drifts from the TS engine on exact ties (e.g. 2.5)."""
    return math.floor(v + 0.5)


@dataclass
class Spec:
    type: str
    label: str
    zone: str
    weight: float


def _layout_cardinal(f: str) -> str:
    if "N" in f:
        return "N"
    if "S" in f:
        return "S"
    return f


def _direction_of(cx: float, cy: float, fp: Rect) -> str:
    dx = cx - (fp.x + fp.w / 2)
    dy = (fp.y + fp.h / 2) - cy
    norm = (math.atan2(dx, dy) * 180 / math.pi + 360) % 360
    return OCTANTS[_js_round(norm / 45) % 8]


def _vastu_room_score(actual: str, ideal: str) -> float:
    ia, ib = OCTANTS.index(actual), OCTANTS.index(ideal)
    d = min(abs(ia - ib), 8 - abs(ia - ib))
    return max(0.0, 1 - d / 3)


def _room_target_area(t: str, s: float) -> float:
    if t == "foyer": return 5.0 * s
    if t == "living": return 22.0 * s
    if t == "dining": return 14.0 * s
    if t == "kitchen": return 11.0 * s
    if t == "toilet": return 3.0
    if t == "pooja": return 3.5 * s
    if t == "office": return 12.0 * s
    if t == "stair": return 7.0
    if t == "corridor": return 5.0
    if t == "store": return 4.0
    if t == "utility": return 4.5 * s
    if t == "master_bedroom": return 18.0 * s
    if t == "bedroom": return 13.0 * s
    if t == "bathroom": return 4.5 * s
    if t == "parking": return 15.0
    if t == "balcony": return 6.0 * s
    if t == "garden": return 20.0 * s
    if t == "pool": return 25.0 * s
    return 10.0 * s


def _bedrooms_per_floor(total: int, floors: int) -> list[int]:
    if floors <= 1:
        return [total]
    out = [0] * floors
    out[0] = 1 if total >= 3 else 0
    remaining = total - out[0]
    f = 1
    while remaining > 0:
        out[f] += 1
        remaining -= 1
        f = f + 1 if f + 1 < floors else 1
    return out


def _bathrooms_per_floor(total: int, floors: int, beds_per_floor: list[int]) -> list[int]:
    if floors <= 1:
        return [total]
    out = [0] * floors
    remaining = total
    for f in range(floors):
        if beds_per_floor[f] > 0 and remaining > 0:
            out[f] = 1
            remaining -= 1
    total_beds = sum(beds_per_floor) or 1
    for f in range(floors):
        if remaining <= 0:
            break
        share = _js_round((remaining * beds_per_floor[f]) / total_beds)
        add = min(share, remaining)
        out[f] += add
        remaining -= add
    f = 1
    while remaining > 0:
        out[f] += 1
        remaining -= 1
        f = f + 1 if f + 1 < floors else 0
    return out


def _balconies_per_floor(total: int, floors: int) -> list[int]:
    if floors <= 1:
        return [total]
    out = [0] * floors
    remaining = total
    f = 1
    while remaining > 0:
        out[f] += 1
        remaining -= 1
        f = f + 1 if f + 1 < floors else 1
    return out


def _spec(t: str, label: str, w: float) -> Spec:
    return Spec(t, label, ZONE_OF[t], w)


def _build_clusters(req: dict, floor_index: int, footprint_area: float) -> list[dict]:
    """Program for one floor as adjacency clusters (each is {zone, weight, rooms})."""
    s = 0.82 + req["luxury"] * 0.1
    is_ground = floor_index == 0

    bpf = _bedrooms_per_floor(req["bedrooms"], req["floors"])
    floor_bedrooms = bpf[floor_index] if floor_index < len(bpf) else 0

    bath_pf = _bathrooms_per_floor(req["bathrooms"], req["floors"], bpf)
    floor_bathrooms = bath_pf[floor_index] if floor_index < len(bath_pf) else 0

    bal_pf = _balconies_per_floor(req["balconies"], req["floors"])
    floor_balconies = bal_pf[floor_index] if floor_index < len(bal_pf) else 0

    floor_rooms: list[Spec] = []

    if is_ground:
        floor_rooms.append(_spec("foyer", "Foyer", _room_target_area("foyer", s)))
        floor_rooms.append(_spec("living", "Living Room", _room_target_area("living", s)))
        floor_rooms.append(_spec("dining", "Dining", _room_target_area("dining", s)))
        floor_rooms.append(_spec("kitchen", "Kitchen", _room_target_area("kitchen", s)))
        floor_rooms.append(_spec("toilet", "Powder Room", _room_target_area("toilet", s)))

        if req["vastu"]:
            floor_rooms.append(_spec("pooja", "Pooja", _room_target_area("pooja", s)))
        if req["homeOffice"] and req["floors"] == 1:
            floor_rooms.append(_spec("office", "Home Office", _room_target_area("office", s)))
        if req["floors"] > 1:
            floor_rooms.append(_spec("stair", "Staircase", _room_target_area("stair", s)))
        if req["floors"] > 2:
            floor_rooms.append(_spec("corridor", "Lift Lobby", _room_target_area("corridor", s)))
        for p in range(req["parking"]):
            floor_rooms.append(_spec("parking", f"Parking {p + 1}", _room_target_area("parking", s)))
        if req["garden"]:
            floor_rooms.append(_spec("garden", "Garden", _room_target_area("garden", s)))
        if req["pool"]:
            floor_rooms.append(_spec("pool", "Swimming Pool", _room_target_area("pool", s)))
    else:
        floor_rooms.append(_spec("stair", "Staircase", _room_target_area("stair", s)))
        floor_rooms.append(_spec("living", "Family Lounge", _room_target_area("living", s) * 0.7))
        if req["homeOffice"] and floor_index == 1:
            floor_rooms.append(_spec("office", "Home Office", _room_target_area("office", s)))
        if req["floors"] > 2 and floor_index < req["floors"] - 1:
            floor_rooms.append(_spec("corridor", "Lift Lobby", _room_target_area("corridor", s)))

    baths_left = floor_bathrooms
    master_floor = 1 if req["floors"] > 1 else 0

    floor_bed_specs = []
    for b in range(floor_bedrooms):
        is_master = floor_index == master_floor and b == 0 and req["bedrooms"] > 1
        bed = _spec("master_bedroom", "Master Bedroom", _room_target_area("master_bedroom", s)) if is_master \
            else _spec("bedroom", f"Bedroom {b + 1}", _room_target_area("bedroom", s))
        
        if baths_left > 0:
            baths_left -= 1
            bath = _spec("bathroom", "Master Bath" if is_master else f"Bathroom {b + 1}", _room_target_area("bathroom", s))
            floor_bed_specs.append((bed, bath))
        else:
            floor_bed_specs.append((bed, None))

    common_baths = []
    for i in range(baths_left):
        common_baths.append(_spec("bathroom", f"Common Bath {i + 1}", _room_target_area("bathroom", s)))

    balconies = []
    for i in range(floor_balconies):
        balconies.append(_spec("balcony", f"Balcony {i + 1}", _room_target_area("balcony", s)))

    service_space = _spec(
        "store" if is_ground else "utility",
        "Store" if is_ground else "Utility",
        _room_target_area("store" if is_ground else "utility", s)
    )

    all_core_rooms = list(floor_rooms)
    for bed, bath in floor_bed_specs:
        all_core_rooms.append(bed)
        if bath:
            all_core_rooms.append(bath)
    all_core_rooms.extend(common_baths)
    all_core_rooms.extend(balconies)
    all_core_rooms.append(service_space)

    total_target_area = sum(r.weight for r in all_core_rooms)
    excess = footprint_area - total_target_area
    if excess > 0:
        outdoor = [r for r in all_core_rooms if r.zone == "outdoor"]
        if outdoor:
            share = excess / len(outdoor)
            for r in outdoor:
                r.weight += share
        else:
            if is_ground:
                all_core_rooms.append(_spec("garden", "Open Yard", excess))
            else:
                all_core_rooms.append(_spec("balcony", "Open Terrace", excess))

    clusters = []
    
    def single(sp):
        clusters.append({"zone": sp.zone, "weight": sp.weight, "rooms": [sp]})
    def attach(bed, bath):
        clusters.append({"zone": bed.zone, "weight": bed.weight + bath.weight, "rooms": [bed, bath]})

    for r in floor_rooms:
        single(r)
    for bed, bath in floor_bed_specs:
        if bath:
            attach(bed, bath)
        else:
            single(bed)
    for r in common_baths:
        single(r)
    for r in balconies:
        single(r)
    single(service_space)

    return clusters


def _slice(rect: Rect, items: list[dict]) -> list[tuple[Rect, dict]]:
    if not items:
        return []
    if len(items) == 1:
        return [(rect, items[0])]
    total = sum(i["weight"] for i in items)
    acc, split = 0.0, 0
    for i, it in enumerate(items):
        acc += it["weight"]
        if acc >= total / 2:
            split = i + 1
            break
    split = min(max(split, 1), len(items) - 1)
    a, b = items[:split], items[split:]
    frac = sum(i["weight"] for i in a) / total

    def aspect(w, h):
        return max(w / max(h, 1e-6), h / max(w, 1e-6))

    v_worst = max(aspect(rect.w * frac, rect.h), aspect(rect.w * (1 - frac), rect.h))
    h_worst = max(aspect(rect.w, rect.h * frac), aspect(rect.w, rect.h * (1 - frac)))

    if v_worst <= h_worst:
        wa = rect.w * frac
        return _slice(Rect(rect.x, rect.y, wa, rect.h), a) + \
            _slice(Rect(rect.x + wa, rect.y, rect.w - wa, rect.h), b)
    ha = rect.h * frac
    return _slice(Rect(rect.x, rect.y, rect.w, ha), a) + \
        _slice(Rect(rect.x, rect.y + ha, rect.w, rect.h - ha), b)


def _layout_cluster(rect: Rect, cluster: dict, cross_len: float) -> list[tuple[Rect, Spec]]:
    rooms = cluster["rooms"]
    if len(rooms) == 1:
        return [(rect, rooms[0])]
    bed, bath = rooms
    f = max(0.2, min(0.34, bath.weight / cluster["weight"]))
    touches_left = rect.x < EPS
    touches_right = abs(rect.x + rect.w - cross_len) < EPS
    if touches_left or touches_right:
        bw = rect.w * f
        if touches_right and not touches_left:
            bath_r = Rect(rect.x + rect.w - bw, rect.y, bw, rect.h)
            bed_r = Rect(rect.x, rect.y, rect.w - bw, rect.h)
        else:
            bath_r = Rect(rect.x, rect.y, bw, rect.h)
            bed_r = Rect(rect.x + bw, rect.y, rect.w - bw, rect.h)
    elif rect.w >= rect.h:
        bw = rect.w * f
        bath_r = Rect(rect.x + rect.w - bw, rect.y, bw, rect.h)
        bed_r = Rect(rect.x, rect.y, rect.w - bw, rect.h)
    else:
        bh = rect.h * f
        bath_r = Rect(rect.x, rect.y + rect.h - bh, rect.w, bh)
        bed_r = Rect(rect.x, rect.y, rect.w, rect.h - bh)
    return [(bed_r, bed), (bath_r, bath)]


def _transform(fp: Rect, card: str, depth_len: float, c: Rect) -> Rect:
    if card == "N":
        return Rect(fp.x + c.x, fp.y + c.y, c.w, c.h)
    if card == "S":
        return Rect(fp.x + c.x, fp.y + (depth_len - (c.y + c.h)), c.w, c.h)
    if card == "W":
        return Rect(fp.x + c.y, fp.y + c.x, c.h, c.w)
    return Rect(fp.x + (depth_len - (c.y + c.h)), fp.y + c.x, c.h, c.w)


def _room_vastu(r: dict, fp: Rect) -> float:
    if not r.get("idealDir"):
        return 0.0
    return _vastu_room_score(_direction_of(r["x"] + r["w"] / 2, r["y"] + r["h"] / 2, fp), r["idealDir"])


def _optimize_vastu(rooms: list[dict], fp: Rect) -> None:
    idx = [i for i, r in enumerate(rooms) if r["type"] in SWAPPABLE]
    guard = 0
    improved = True
    while improved and guard < 8:
        guard += 1
        improved = False
        for a in idx:
            for b in idx:
                if a >= b:
                    continue
                ra, rb = rooms[a], rooms[b]
                area_a, area_b = ra["w"] * ra["h"], rb["w"] * rb["h"]
                if abs(area_a - area_b) / max(area_a, area_b) > 0.45:
                    continue
                before = _room_vastu(ra, fp) + _room_vastu(rb, fp)
                for k in ("type", "label", "zone", "idealDir"):
                    ra[k], rb[k] = rb[k], ra[k]
                after = _room_vastu(ra, fp) + _room_vastu(rb, fp)
                if after > before + 1e-9:
                    improved = True
                else:
                    for k in ("type", "label", "zone", "idealDir"):
                        ra[k], rb[k] = rb[k], ra[k]


ROOM_IDEAL_POS = {
    "pooja": (1.0, 0.0),        # NE
    "kitchen": (1.0, 1.0),      # SE
    "master_bedroom": (0.0, 1.0), # SW
    "bedroom": (0.0, 0.5),      # W
    "living": (0.5, 0.0),       # N
    "dining": (0.0, 0.5),       # W
    "bathroom": (0.0, 0.0),     # NW
    "toilet": (0.0, 0.0),       # NW
    "stair": (0.0, 1.0),        # SW
    "store": (0.0, 1.0),        # SW
    "office": (0.0, 0.5),       # W
    "parking": (0.0, 0.0),      # NW
}

def _get_vastu_sort_key(c: dict, axis: str) -> float:
    if not c.get("rooms"):
        return 0.5
    primary_type = c["rooms"][0].type
    pos = ROOM_IDEAL_POS.get(primary_type, (0.5, 0.5))
    return pos[0] if axis == "x" else pos[1]


def _layout_floor(fp: Rect, clusters: list[dict], req: dict) -> list[dict]:
    card = _layout_cardinal(req["facing"])
    horizontal = card in ("E", "W")
    cross_len = fp.h if horizontal else fp.w
    depth_len = fp.w if horizontal else fp.h

    by_zone: dict[str, list[dict]] = {}
    for c in clusters:
        by_zone.setdefault(c["zone"], []).append(c)
    bands = [[c for z in zs for c in by_zone.get(z, [])] for zs in BAND_GROUPS]
    bands = [g for g in bands if g]
    total_w = sum(c["weight"] for g in bands for c in g) or 1

    rooms: list[dict] = []
    cursor = 0.0
    for i, group in enumerate(bands):
        band_w = sum(c["weight"] for c in group)
        band_depth = depth_len - cursor if i == len(bands) - 1 else (band_w / total_w) * depth_len
        band = Rect(0, cursor, cross_len, band_depth)
        axis = "y" if horizontal else "x"
        if req["vastu"]:
            ordered = sorted(group, key=lambda c: (_get_vastu_sort_key(c, axis), -c["weight"]))
        else:
            ordered = sorted(group, key=lambda c: -c["weight"])
        for crect, cluster in _slice(band, ordered):
            for prect, sp in _layout_cluster(crect, cluster, cross_len):
                r = _transform(fp, card, depth_len, prect)
                rooms.append({
                    "id": f"{sp.type}-{len(rooms)}", "type": sp.type, "label": sp.label,
                    "zone": sp.zone, "idealDir": IDEAL_DIRECTION.get(sp.type),
                    "x": r.x, "y": r.y, "w": r.w, "h": r.h,
                })
        cursor += band_depth

    if req["vastu"]:
        _optimize_vastu(rooms, fp)
    return rooms


def _on_boundary(v: float, edge: float) -> bool:
    return abs(v - edge) < 0.05


def _place_openings(rooms: list[dict], fp: Rect) -> tuple[list[dict], list[dict]]:
    doors, windows = [], []
    right, bottom = fp.x + fp.w, fp.y + fp.h
    for room in rooms:
        if room["type"] == "garden":
            continue
        x, y, w, h = room["x"], room["y"], room["w"], room["h"]
        edges = [
            ("v", x, y, h, _on_boundary(x, fp.x)),
            ("v", x + w, y, h, _on_boundary(x + w, right)),
            ("h", y, x, w, _on_boundary(y, fp.y)),
            ("h", y + h, x, w, _on_boundary(y + h, bottom)),
        ]
        interior = [e for e in edges if not e[4] and e[3] > 1.0]
        door_edge = sorted(interior or edges, key=lambda e: -e[3])[0]
        o, at, p0, length, _ = door_edge
        dw = min(0.95, length * 0.4)
        mid = p0 + length / 2
        doors.append({
            "roomId": room["id"], "orientation": o, "width": round(dw, 3),
            "exterior": room["type"] == "foyer",
            "x": round(at if o == "v" else mid - dw / 2, 3),
            "y": round(mid - dw / 2 if o == "v" else at, 3),
        })
        if room["type"] not in ("stair", "store", "utility", "parking", "foyer", "corridor"):
            for o, at, p0, length, ext in edges:
                if ext and length > 1.6:
                    ww = min(1.5, length * 0.5)
                    mid = p0 + length / 2
                    windows.append({
                        "roomId": room["id"], "orientation": o, "width": round(ww, 3),
                        "x": round(at if o == "v" else mid - ww / 2, 3),
                        "y": round(mid - ww / 2 if o == "v" else at, 3),
                    })
    return doors, windows


def _merge(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not intervals:
        return []
    s = sorted(intervals)
    out = [list(s[0])]
    for a, b in s[1:]:
        if a <= out[-1][1] + 0.04:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def _generate_walls(rooms: list[dict], fp: Rect) -> list[dict]:
    verticals: dict[float, list[tuple[float, float]]] = {}
    horizontals: dict[float, list[tuple[float, float]]] = {}

    def add(m, coord, a, b):
        if abs(b - a) < 0.04:
            return
        m.setdefault(_js_round(coord * 100) / 100, []).append((min(a, b), max(a, b)))

    for r in rooms:
        add(verticals, r["x"], r["y"], r["y"] + r["h"])
        add(verticals, r["x"] + r["w"], r["y"], r["y"] + r["h"])
        add(horizontals, r["y"], r["x"], r["x"] + r["w"])
        add(horizontals, r["y"] + r["h"], r["x"], r["x"] + r["w"])
    add(verticals, fp.x, fp.y, fp.y + fp.h)
    add(verticals, fp.x + fp.w, fp.y, fp.y + fp.h)
    add(horizontals, fp.y, fp.x, fp.x + fp.w)
    add(horizontals, fp.y + fp.h, fp.x, fp.x + fp.w)

    walls = []
    for x, ivs in verticals.items():
        ext = abs(x - fp.x) < 0.04 or abs(x - (fp.x + fp.w)) < 0.04
        for a, b in _merge(ivs):
            walls.append({"x1": x, "y1": round(a, 3), "x2": x, "y2": round(b, 3),
                          "orientation": "v", "type": "exterior" if ext else "interior",
                          "thickness": 0.66 if ext else 0.46})
    for y, ivs in horizontals.items():
        ext = abs(y - fp.y) < 0.04 or abs(y - (fp.y + fp.h)) < 0.04
        for a, b in _merge(ivs):
            walls.append({"x1": round(a, 3), "y1": y, "x2": round(b, 3), "y2": y,
                          "orientation": "h", "type": "exterior" if ext else "interior",
                          "thickness": 0.66 if ext else 0.46})
    return walls


def _layout_floor_poly(
    fp_poly: list[tuple[float, float]],
    clusters: list[dict],
    req: dict,
) -> list[dict]:
    fp_bbox = polygon_bbox(fp_poly)
    card = _layout_cardinal(req["facing"])
    horizontal = card in ("E", "W")

    by_zone: dict[str, list[dict]] = {}
    for c in clusters:
        by_zone.setdefault(c["zone"], []).append(c)

    bands = [[c for z in zs for c in by_zone.get(z, [])] for zs in BAND_GROUPS]
    bands = [g for g in bands if g]

    def band_weight(g):
        return sum(c["weight"] for c in g)

    band_weights = [band_weight(g) for g in bands]
    split_axis = "x" if horizontal else "y"
    needs_reverse = card in ("S", "W")

    ordered_weights = list(reversed(band_weights)) if needs_reverse else band_weights
    band_polys = subdivide_polygon(fp_poly, ordered_weights, split_axis)
    if needs_reverse:
        band_polys = list(reversed(band_polys))

    rooms: list[dict] = []
    for i, group in enumerate(bands):
        band_poly = band_polys[i] if i < len(band_polys) else fp_poly
        inner_axis = "x" if split_axis == "y" else "y"
        if req["vastu"]:
            ordered = sorted(group, key=lambda c: (_get_vastu_sort_key(c, inner_axis), -c["weight"]))
        else:
            ordered = sorted(group, key=lambda c: -c["weight"])

        cluster_weights = [c["weight"] for c in ordered]
        cluster_polys = subdivide_polygon(band_poly, cluster_weights, inner_axis)

        for ci, cluster in enumerate(ordered):
            c_poly = cluster_polys[ci] if ci < len(cluster_polys) else band_poly

            if len(cluster["rooms"]) == 1:
                spec = cluster["rooms"][0]
                bbox = polygon_bbox(c_poly)
                rooms.append({
                    "id": f"{spec.type}-{len(rooms)}",
                    "type": spec.type,
                    "label": spec.label,
                    "zone": spec.zone,
                    "idealDir": IDEAL_DIRECTION.get(spec.type),
                    "x": bbox.x,
                    "y": bbox.y,
                    "w": bbox.w,
                    "h": bbox.h,
                    "polygon": c_poly,
                })
            else:
                bed, bath = cluster["rooms"]
                f = max(0.2, min(0.34, bath.weight / cluster["weight"]))
                sub_polys = subdivide_polygon(c_poly, [1 - f, f], inner_axis)

                for k in range(2):
                    spec = bed if k == 0 else bath
                    sp = sub_polys[k] if k < len(sub_polys) else c_poly
                    bbox = polygon_bbox(sp)
                    rooms.append({
                        "id": f"{spec.type}-{len(rooms)}",
                        "type": spec.type,
                        "label": spec.label,
                        "zone": spec.zone,
                        "idealDir": IDEAL_DIRECTION.get(spec.type),
                        "x": bbox.x,
                        "y": bbox.y,
                        "w": bbox.w,
                        "h": bbox.h,
                        "polygon": sp,
                    })

    if req["vastu"]:
        _optimize_vastu(rooms, fp_bbox)
    return rooms


def _place_openings_poly(
    rooms: list[dict],
    fp_poly: list[tuple[float, float]],
) -> tuple[list[dict], list[dict]]:
    doors, windows = [], []
    for room in rooms:
        if room["type"] == "garden":
            continue
        rp = room.get("polygon")
        if not rp or len(rp) < 3:
            continue

        edges = polygon_edges(rp)
        classified = []
        for e in edges:
            ext = edge_on_boundary(e.x1, e.y1, e.x2, e.y2, fp_poly)
            classified.append({
                "x1": e.x1, "y1": e.y1, "x2": e.x2, "y2": e.y2,
                "length": e.length, "orientation": e.orientation,
                "ext": ext
            })

        interior = [e for e in classified if not e["ext"] and e["length"] > 1.0]
        candidates = interior if interior else classified
        if candidates:
            door_edge = sorted(candidates, key=lambda e: -e["length"])[0]
            dw = min(0.95, door_edge["length"] * 0.4)
            mx = (door_edge["x1"] + door_edge["x2"]) / 2.0
            my = (door_edge["y1"] + door_edge["y2"]) / 2.0
            doors.append({
                "roomId": room["id"],
                "orientation": door_edge["orientation"],
                "width": round(dw, 3),
                "exterior": room["type"] == "foyer",
                "x": round(door_edge["x1"] if door_edge["orientation"] == "v" else mx - dw / 2.0, 3),
                "y": round(my - dw / 2.0 if door_edge["orientation"] == "v" else door_edge["y1"], 3),
            })

        habitable = room["type"] not in ("stair", "store", "utility", "parking", "foyer", "corridor")
        if habitable:
            for e in classified:
                if e["ext"] and e["length"] > 1.6:
                    ww = min(1.5, e["length"] * 0.5)
                    mx = (e["x1"] + e["x2"]) / 2.0
                    my = (e["y1"] + e["y2"]) / 2.0
                    windows.append({
                        "roomId": room["id"],
                        "orientation": e["orientation"],
                        "width": round(ww, 3),
                        "x": round(e["x1"] if e["orientation"] == "v" else mx - ww / 2.0, 3),
                        "y": round(my - ww / 2.0 if e["orientation"] == "v" else e["y1"], 3),
                    })
    return doors, windows


def _generate_polygon_walls(
    rooms: list[dict],
    fp_poly: list[tuple[float, float]],
) -> list[dict]:
    exterior_t = 0.66
    interior_t = 0.46

    def seg_key(x1: float, y1: float, x2: float, y2: float) -> str:
        k1 = _js_round(x1 * 100)
        k2 = _js_round(y1 * 100)
        k3 = _js_round(x2 * 100)
        k4 = _js_round(y2 * 100)
        if k1 < k3 or (k1 == k3 and k2 < k4):
            return f"{k1},{k2}-{k3},{k4}"
        return f"{k3},{k4}-{k1},{k2}"

    seen = {}
    for room in rooms:
        rp = room.get("polygon")
        if not rp or len(rp) < 3:
            continue
        for edge in polygon_edges(rp):
            key = seg_key(edge.x1, edge.y1, edge.x2, edge.y2)
            if key not in seen:
                ext = edge_on_boundary(edge.x1, edge.y1, edge.x2, edge.y2, fp_poly)
                seen[key] = {
                    "x1": round(edge.x1, 3), "y1": round(edge.y1, 3),
                    "x2": round(edge.x2, 3), "y2": round(edge.y2, 3),
                    "orientation": edge.orientation,
                    "type": "exterior" if ext else "interior",
                    "thickness": exterior_t if ext else interior_t,
                }

    for edge in polygon_edges(fp_poly):
        key = seg_key(edge.x1, edge.y1, edge.x2, edge.y2)
        if key not in seen:
            seen[key] = {
                "x1": round(edge.x1, 3), "y1": round(edge.y1, 3),
                "x2": round(edge.x2, 3), "y2": round(edge.y2, 3),
                "orientation": edge.orientation,
                "type": "exterior",
                "thickness": exterior_t,
            }

    return list(seen.values())


def _floor_metrics_poly(
    rooms: list[dict],
    fp_poly: list[tuple[float, float]],
    fp_bbox: Rect,
) -> dict:
    built_up_area = polygon_area(fp_poly)
    efficiency = max(0.78, min(0.9, 0.92 - len(rooms) * 0.0045))

    perimeter = 0.0
    n = len(fp_poly)
    for i in range(n):
        x1, y1 = fp_poly[i]
        x2, y2 = fp_poly[(i + 1) % n]
        perimeter += math.hypot(x2 - x1, y2 - y1)

    return {
        "builtUpArea": built_up_area,
        "carpetArea": built_up_area * efficiency,
        "efficiency": efficiency,
        "perimeter": perimeter,
        "vastuScore": _vastu(rooms, fp_bbox),
    }


def _vastu(rooms: list[dict], fp: Rect) -> int:
    scored = [r for r in rooms if r.get("idealDir")]
    if not scored:
        return 100
    return _js_round(sum(_room_vastu(r, fp) for r in scored) / len(scored) * 100)


M_TO_FT = 3.28084


MIN_ROOM_AREA = {
    "foyer": 2.0,
    "living": 10.0,
    "dining": 6.0,
    "kitchen": 5.0,
    "toilet": 1.5,
    "pooja": 1.5,
    "office": 6.0,
    "stair": 4.0,
    "corridor": 2.0,
    "store": 1.5,
    "utility": 2.0,
    "master_bedroom": 10.0,
    "bedroom": 8.0,
    "bathroom": 2.5,
    "parking": 11.0,
    "balcony": 2.0,
    "garden": 5.0,
    "pool": 8.0,
}

def validate_plan_requirements(plan: dict, req: dict) -> dict:
    errors = []
    
    bedroom_count = 0
    bathroom_count = 0
    parking_count = 0
    balcony_count = 0
    has_garden = False
    has_pool = False
    has_office = False

    for floor in plan["floors"]:
        for room in floor["rooms"]:
            if room["type"] in ("bedroom", "master_bedroom"):
                bedroom_count += 1
            if room["type"] == "bathroom":
                bathroom_count += 1
            if room["type"] == "parking":
                parking_count += 1
            if room["type"] == "balcony" and "Balcony" in room["label"]:
                balcony_count += 1
            if room["type"] == "garden" and room["label"] == "Garden":
                has_garden = True
            if room["type"] == "pool":
                has_pool = True
            if room["type"] == "office":
                has_office = True

            # Check min area
            area = room["w"] * room["h"]
            min_area = MIN_ROOM_AREA.get(room["type"], 2.0)
            if area < min_area:
                errors.append(f"{room['label']} is too small ({area:.1f} m², minimum is {min_area:g} m²).")

    if bedroom_count != req["bedrooms"]:
        errors.append(f"Expected {req['bedrooms']} bedrooms, but generated {bedroom_count}.")
    if bathroom_count != req["bathrooms"]:
        errors.append(f"Expected {req['bathrooms']} bathrooms, but generated {bathroom_count}.")
    if parking_count != req["parking"]:
        errors.append(f"Expected {req['parking']} parking spaces, but generated {parking_count}.")
    if balcony_count != req["balconies"]:
        errors.append(f"Expected {req['balconies']} balconies, but generated {balcony_count}.")
    if req["garden"] and not has_garden:
        errors.append("Garden was requested but not generated.")
    if req["pool"] and not has_pool:
        errors.append("Swimming Pool was requested but not generated.")
    if req["homeOffice"] and not has_office:
        errors.append("Home Office was requested but not generated.")

    return {
        "ok": len(errors) == 0,
        "errors": errors
    }


def generate_plan(req: dict) -> dict[str, Any]:
    """req: full Requirements dict. Returns a PlanResult dict with rooms,
    doors, windows and walls per floor."""
    base = max(0.9, min(req["plotWidth"], req["plotDepth"]) * 0.08)
    sb = {"front": base * 1.4, "rear": base, "side": base}

    has_polygon = req.get("plotPolygon") is not None and len(req["plotPolygon"]) >= 3

    if has_polygon:
        plot_poly = [tuple(p) for p in req["plotPolygon"]]
        avg_setback = (sb["front"] + sb["rear"] + sb["side"]) / 3.0
        fp_poly = inset_polygon(plot_poly, avg_setback)
        fp_bbox = polygon_bbox(fp_poly)
        plot_area = polygon_area(plot_poly)

        floors = []
        for i in range(req["floors"]):
            rooms = _layout_floor_poly(fp_poly, _build_clusters(req, i, polygon_area(fp_poly)), req)
            doors, windows = _place_openings_poly(rooms, fp_poly)
            floors.append({
                "floor": i,
                "name": FLOOR_NAMES[i] if i < len(FLOOR_NAMES) else f"Floor {i}",
                "footprint": fp_bbox.to_dict(),
                "footprintPolygon": fp_poly,
                "rooms": rooms,
                "doors": doors,
                "windows": windows,
                "walls": _generate_polygon_walls(rooms, fp_poly),
                "metrics": _floor_metrics_poly(rooms, fp_poly, fp_bbox),
            })

        avg_vastu = _js_round(sum(f["metrics"]["vastuScore"] for f in floors) / len(floors))
        total_built = sum(f["metrics"]["builtUpArea"] for f in floors)

        result = {
            "plotArea": plot_area,
            "plotPolygon": plot_poly,
            "footprint": fp_bbox.to_dict(),
            "setback": sb,
            "floors": floors,
            "summary": {
                "vastuScore": avg_vastu,
                "builtUpArea": round(total_built, 2),
                "floors": len(floors)
            },
        }
        result["suggestions"] = _build_suggestions(result, req)
        result["validation"] = validate_plan_requirements(result, req)
        return result

    fp = Rect(sb["side"], sb["front"],
              max(3.0, req["plotWidth"] - sb["side"] * 2),
              max(3.0, req["plotDepth"] - sb["front"] - sb["rear"]))

    floors = []
    for i in range(req["floors"]):
        rooms = _layout_floor(fp, _build_clusters(req, i, fp.w * fp.h), req)
        doors, windows = _place_openings(rooms, fp)
        walls = _generate_walls(rooms, fp)
        built = fp.w * fp.h
        eff = max(0.78, min(0.9, 0.92 - len(rooms) * 0.0045))
        floors.append({
            "floor": i, "name": FLOOR_NAMES[i] if i < len(FLOOR_NAMES) else f"Floor {i}",
            "footprint": asdict(fp), "rooms": rooms, "doors": doors,
            "windows": windows, "walls": walls,
            "metrics": {
                "builtUpArea": built, "carpetArea": built * eff,
                "efficiency": eff, "perimeter": 2 * (fp.w + fp.h),
                "vastuScore": _vastu(rooms, fp),
            },
        })

    avg_vastu = _js_round(sum(f["metrics"]["vastuScore"] for f in floors) / len(floors))
    total_built = sum(f["metrics"]["builtUpArea"] for f in floors)
    result = {
        "plotArea": round(req["plotWidth"] * req["plotDepth"], 2),
        "footprint": asdict(fp), "setback": sb, "floors": floors,
        "summary": {"vastuScore": avg_vastu, "builtUpArea": round(total_built, 2),
                     "floors": len(floors)},
    }
    result["suggestions"] = _build_suggestions(result, req)
    result["validation"] = validate_plan_requirements(result, req)
    return result


_COST_RATE = {"economy": 1400, "standard": 1900, "premium": 2600, "luxury": 3600}


def _inr(n: float) -> str:
    """Format like JS toLocaleString("en-IN", {maximumFractionDigits: 0}): 12,34,567."""
    digits = str(_js_round(n))
    head, tail = digits[:-3], digits[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join(groups + [tail])


def _build_suggestions(plan: dict, req: dict) -> list[dict]:
    """Port of buildSuggestions in apps/web/src/lib/floorplan/engine.ts."""
    out: list[dict] = []
    fp = plan["footprint"]
    right, bottom = fp["x"] + fp["w"], fp["y"] + fp["h"]
    blind = 0
    for f in plan["floors"]:
        for r in f["rooms"]:
            if r["type"] in ("bedroom", "master_bedroom"):
                has_ext = (_on_boundary(r["x"], fp["x"]) or _on_boundary(r["x"] + r["w"], right)
                           or _on_boundary(r["y"], fp["y"]) or _on_boundary(r["y"] + r["h"], bottom))
                if not has_ext:
                    blind += 1
    out.append(
        {"kind": "ventilation", "severity": "good",
         "message": "Every bedroom has at least one external wall for cross-ventilation and daylight."}
        if blind == 0 else
        {"kind": "ventilation", "severity": "warn",
         "message": f"{blind} bedroom(s) are landlocked — consider a light shaft or rearranging to an outer wall."}
    )

    floors = plan["floors"]
    avg = _js_round(sum(f["metrics"]["vastuScore"] for f in floors) / len(floors))
    out.append({
        "kind": "vastu",
        "severity": "good" if avg >= 75 else "info" if avg >= 55 else "warn",
        "message": f"Vastu compliance score: {avg}/100"
                   + (" — strong alignment with directional principles." if avg >= 75
                      else " — kitchen/master placement could be tuned for a higher score."),
    })

    total_area = sum(f["metrics"]["builtUpArea"] for f in floors)
    eff = floors[0]["metrics"]["efficiency"]
    out.append({
        "kind": "space",
        "severity": "good" if eff >= 0.85 else "info",
        "message": f"Carpet-area efficiency ≈ {_js_round(eff * 100)}%. "
                   f"Built-up {_js_round(total_area)} m² across {len(floors)} floor(s).",
    })

    if req["floors"] > 1:
        out.append({"kind": "circulation", "severity": "info",
                    "message": "Staircase is stacked vertically across floors for an efficient structural core."})

    rate = _COST_RATE[req["budget"]]
    out.append({
        "kind": "cost",
        "severity": "info",
        "message": f"Indicative construction estimate ≈ ₹{_inr(total_area * 10.7639 * rate)} "
                   f"at {req['budget']} finish (≈₹{rate}/ft²).",
    })
    return out


def to_flat(floor: dict) -> dict:
    """Flatten one floor to { rooms, doors, windows, walls } in feet."""
    def r2(n):
        return round(n * M_TO_FT, 2)
    return {
        "unit": "ft", "floor": floor["name"],
        "rooms": [{"name": r["label"], "type": r["type"],
                   "width": r2(r["w"]), "height": r2(r["h"]),
                   "x": r2(r["x"]), "y": r2(r["y"]),
                   "area": round(r["w"] * r["h"] * M_TO_FT * M_TO_FT, 2)} for r in floor["rooms"]],
        "doors": [{"x": r2(d["x"]), "y": r2(d["y"]), "width": r2(d["width"]),
                   "orientation": d["orientation"], "roomId": d["roomId"]} for d in floor["doors"]],
        "windows": [{"x": r2(w["x"]), "y": r2(w["y"]), "width": r2(w["width"]),
                     "orientation": w["orientation"], "roomId": w["roomId"]} for w in floor["windows"]],
        "walls": [{"x1": r2(w["x1"]), "y1": r2(w["y1"]), "x2": r2(w["x2"]), "y2": r2(w["y2"]),
                   "type": w["type"], "thickness": r2(w["thickness"])} for w in floor["walls"]],
    }
