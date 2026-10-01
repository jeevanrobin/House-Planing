import { Loader } from "@googlemaps/js-api-loader";

let loaderPromise: Promise<typeof google> | null = null;

export const MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "";

export const hasMapsKey = MAPS_API_KEY.length > 0;

/**
 * Load the Google Maps JS API once (drawing, geometry, places).
 * Returns a cached promise so repeated calls share a single script load.
 */
export function loadGoogleMaps(): Promise<typeof google> {
  if (!hasMapsKey) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set"));
  }
  if (!loaderPromise) {
    const loader = new Loader({
      apiKey: MAPS_API_KEY,
      version: "weekly",
      libraries: ["geometry", "places", "marker"],
    });
    loaderPromise = loader.load();
  }
  return loaderPromise;
}
