"use client";

import * as React from "react";
import { Search, Layers, LocateFixed } from "lucide-react";
import { loadGoogleMaps } from "@/lib/maps/loader";
import type { LatLng } from "@/lib/geo/plot-geometry";
import { cn } from "@/lib/utils";

export type MapType = "satellite" | "hybrid" | "terrain" | "roadmap";

export interface PlotMapHandle {
  startDrawing: () => void;
  clear: () => void;
}

interface Props {
  initialPoints?: LatLng[];
  onChange: (points: LatLng[]) => void;
  onError?: (message: string) => void;
  reloadSignal?: number;
  className?: string;
}

const MAP_TYPES: { id: MapType; label: string }[] = [
  { id: "hybrid", label: "Hybrid" },
  { id: "satellite", label: "Satellite" },
  { id: "terrain", label: "Terrain" },
  { id: "roadmap", label: "Map" },
];

const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 }; // Bengaluru
const POLY_STYLE = {
  fillColor: "#6366f1",
  fillOpacity: 0.22,
  strokeColor: "#6366f1",
  strokeWeight: 2.5,
  editable: true,
  draggable: true,
};

export const PlotMap = React.forwardRef<PlotMapHandle, Props>(function PlotMap(
  { initialPoints, onChange, onError, reloadSignal = 0, className },
  ref,
) {
  const mapDiv = React.useRef<HTMLDivElement>(null);
  const searchInput = React.useRef<HTMLInputElement>(null);
  const mapRef = React.useRef<google.maps.Map | null>(null);
  const polyRef = React.useRef<google.maps.Polygon | null>(null);
  const drawListeners = React.useRef<google.maps.MapsEventListener[]>([]);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const [mapType, setMapType] = React.useState<MapType>("hybrid");
  const [ready, setReady] = React.useState(false);
  const [drawing, setDrawing] = React.useState(false);
  const [locating, setLocating] = React.useState(false);

  /** Pan map to the user's current position via browser geolocation. */
  const goToCurrentLocation = React.useCallback(() => {
    if (!mapRef.current || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        mapRef.current?.panTo(loc);
        mapRef.current?.setZoom(18);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  const pathToPoints = (poly: google.maps.Polygon): LatLng[] =>
    poly.getPath().getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));

  const emit = React.useCallback(() => {
    if (polyRef.current) onChangeRef.current(pathToPoints(polyRef.current));
  }, []);

  // Live editing: move / add / remove vertices, drag the whole polygon.
  const attachEditListeners = React.useCallback(
    (poly: google.maps.Polygon) => {
      const path = poly.getPath();
      if (path) {
        ["set_at", "insert_at", "remove_at"].forEach((ev) => path.addListener(ev, emit));
      }
      poly.addListener("dragend", emit);
      poly.addListener("rightclick", (e: google.maps.PolyMouseEvent) => {
        if (e.vertex != null && poly.getPath().getLength() > 3) {
          poly.getPath().removeAt(e.vertex);
          emit();
        }
      });
    },
    [emit],
  );

  const fitTo = (poly: google.maps.Polygon) => {
    const bounds = new google.maps.LatLngBounds();
    poly.getPath().forEach((ll) => bounds.extend(ll));
    if (poly.getPath().getLength()) mapRef.current?.fitBounds(bounds, 64);
  };

  const stopDrawing = React.useCallback(() => {
    drawListeners.current.forEach((l) => l.remove());
    drawListeners.current = [];
    mapRef.current?.setOptions({ disableDoubleClickZoom: false });
    setDrawing(false);
  }, []);

  const loadPolygon = React.useCallback(
    (pts: LatLng[]) => {
      polyRef.current?.setMap(null);
      const poly = new google.maps.Polygon({ ...POLY_STYLE, paths: pts });
      poly.setMap(mapRef.current);
      polyRef.current = poly;
      attachEditListeners(poly);
      emit();
      fitTo(poly);
    },
    [attachEditListeners, emit],
  );

  // ---- init map once ----
  React.useEffect(() => {
    let cancelled = false;
    // Google calls this global on authentication failure (e.g. an invalid or
    // unauthorised key). Surface it so the selector can fall back gracefully.
    (window as Window & { gm_authFailure?: () => void }).gm_authFailure = () =>
      onError?.("Google Maps rejected this API key (InvalidKey). Restricted, expired, or wrong key type.");
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapDiv.current) return;
        const map = new g.maps.Map(mapDiv.current, {
          center: DEFAULT_CENTER,
          zoom: 18,
          mapTypeId: "hybrid",
          tilt: 0,
          zoomControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          mapTypeControl: false,
          gestureHandling: "greedy",
        });
        mapRef.current = map;

        // If we have saved points, load them; otherwise try browser geolocation.
        if (initialPoints?.length) {
          loadPolygon(initialPoints);
        } else if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              map.panTo(loc);
              map.setZoom(18);
            },
            () => { /* permission denied or error – stay at default center */ },
            { enableHighAccuracy: true, timeout: 10000 },
          );
        }

        // Places search → recenter (Autocomplete is best-effort).
        try {
          if (searchInput.current && g.maps.places?.Autocomplete) {
            const ac = new g.maps.places.Autocomplete(searchInput.current, {
              fields: ["geometry"],
            });
            ac.addListener("place_changed", () => {
              const loc = ac.getPlace().geometry?.location;
              if (loc) {
                map.panTo(loc);
                map.setZoom(19);
              }
            });
          }
        } catch {
          /* search autocomplete unavailable */
        }

        setReady(true);
      })
      .catch((e) => onError?.(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- (re)load on external signal ----
  React.useEffect(() => {
    if (!ready) return;
    stopDrawing();
    polyRef.current?.setMap(null);
    polyRef.current = null;
    if (initialPoints?.length) loadPolygon(initialPoints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal, ready]);

  React.useImperativeHandle(ref, () => ({
    startDrawing: () => {
      if (!mapRef.current) return;
      stopDrawing();
      polyRef.current?.setMap(null);
      const poly = new google.maps.Polygon({ ...POLY_STYLE, paths: [[]] });
      poly.setMap(mapRef.current);
      polyRef.current = poly;
      attachEditListeners(poly);
      onChangeRef.current([]);
      mapRef.current.setOptions({ disableDoubleClickZoom: true });
      setDrawing(true);

      // Click to add vertices; double-click to finish.
      drawListeners.current.push(
        mapRef.current.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) {
            poly.getPath().push(e.latLng);
            emit();
          }
        }),
        mapRef.current.addListener("dblclick", () => {
          stopDrawing();
          if (polyRef.current) fitTo(polyRef.current);
        }),
      );
    },
    clear: () => {
      stopDrawing();
      polyRef.current?.setMap(null);
      polyRef.current = null;
      onChangeRef.current([]);
    },
  }));

  React.useEffect(() => {
    mapRef.current?.setMapTypeId(mapType);
  }, [mapType]);

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border", className)}>
      <div className="absolute left-3 top-3 z-10 flex w-[min(420px,calc(100%-1.5rem))] items-center gap-2 rounded-xl glass-strong px-3 py-2 shadow-glass">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={searchInput}
          placeholder="Search a location or address…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {drawing && (
        <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full glass-strong px-3 py-1.5 text-xs font-medium shadow-glass">
          Click to add corners · double-click to finish
        </div>
      )}

      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-xl glass-strong p-1 shadow-glass">
        <Layers className="ml-1 size-4 text-muted-foreground" />
        {MAP_TYPES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMapType(m.id)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              mapType === m.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary/60",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <button
        onClick={goToCurrentLocation}
        title="Go to my location"
        className="absolute bottom-4 right-3 z-10 flex size-10 items-center justify-center rounded-xl glass-strong shadow-glass transition-colors hover:bg-secondary/60"
      >
        <LocateFixed className={cn("size-5 text-muted-foreground", locating && "animate-pulse text-primary")} />
      </button>

      <div ref={mapDiv} className="h-[420px] w-full bg-muted sm:h-[560px]" />
    </div>
  );
});
