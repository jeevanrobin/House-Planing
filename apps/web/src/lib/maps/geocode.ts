import type { LatLng } from "@/lib/geo/plot-geometry";

export interface PlotAddress {
  address: string;
  city: string;
  state: string;
  country: string;
}

const EMPTY: PlotAddress = { address: "", city: "", state: "", country: "" };

function pick(comps: google.maps.GeocoderAddressComponent[], type: string): string {
  return comps.find((c) => c.types.includes(type))?.long_name ?? "";
}

/** Reverse-geocode a point into a structured address. Requires Maps loaded. */
export async function reverseGeocode(point: LatLng): Promise<PlotAddress> {
  if (typeof google === "undefined" || !google.maps) return EMPTY;
  const geocoder = new google.maps.Geocoder();
  try {
    const { results } = await geocoder.geocode({ location: point });
    if (!results?.length) return EMPTY;
    const best = results[0];
    const c = best.address_components;
    return {
      address: best.formatted_address,
      city:
        pick(c, "locality") ||
        pick(c, "administrative_area_level_2") ||
        pick(c, "postal_town"),
      state: pick(c, "administrative_area_level_1"),
      country: pick(c, "country"),
    };
  } catch {
    return EMPTY;
  }
}
