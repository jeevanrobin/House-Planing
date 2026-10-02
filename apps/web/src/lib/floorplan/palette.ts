import type { RoomType, Zone } from "./types";

/** Fill colour per zone (works on light & dark via opacity). */
export const ZONE_FILL: Record<Zone, string> = {
  public: "#6366f1",
  service: "#14b8a6",
  private: "#f59e0b",
  circulation: "#64748b",
  outdoor: "#22c55e",
};

export const ROOM_SHORT: Partial<Record<RoomType, string>> = {
  master_bedroom: "Master Bed",
  bedroom: "Bedroom",
  living: "Living",
  dining: "Dining",
  kitchen: "Kitchen",
  bathroom: "Bath",
  toilet: "WC",
  pooja: "Pooja",
  stair: "Stair",
  foyer: "Foyer",
  balcony: "Balcony",
  parking: "Parking",
  office: "Office",
  store: "Store",
  utility: "Wash Area",
  garden: "Garden",
  pool: "Pool",
  corridor: "Corridor",
  lift: "Lift",
};
