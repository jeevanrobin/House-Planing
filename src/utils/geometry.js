const EARTH_RADIUS_METERS = 6378137;
const SQ_METERS_TO_SQ_FEET = 10.7639;

const toRadians = (value) => (value * Math.PI) / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Convert the latitude/longitude points into local planar coordinates so the
// polygon area can be approximated with the shoelace formula.
function projectCoordinate(point, referenceLatitude) {
  return {
    x:
      EARTH_RADIUS_METERS *
      toRadians(point.longitude) *
      Math.cos(toRadians(referenceLatitude)),
    y: EARTH_RADIUS_METERS * toRadians(point.latitude),
  };
}

export function getPolygonAreaSqFt(points) {
  if (!points || points.length < 3) {
    return 0;
  }

  const averageLatitude =
    points.reduce((total, point) => total + point.latitude, 0) / points.length;
  const projectedPoints = points.map((point) => projectCoordinate(point, averageLatitude));

  let twiceArea = 0;

  projectedPoints.forEach((point, index) => {
    const nextPoint = projectedPoints[(index + 1) % projectedPoints.length];
    twiceArea += point.x * nextPoint.y - nextPoint.x * point.y;
  });

  const areaSqMeters = Math.abs(twiceArea) / 2;
  return areaSqMeters * SQ_METERS_TO_SQ_FEET;
}

export function getPlotAspectRatio(points) {
  if (!points || points.length < 2) {
    return 1;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const averageLatitude = (minLatitude + maxLatitude) / 2;

  const heightMeters = EARTH_RADIUS_METERS * toRadians(maxLatitude - minLatitude);
  const widthMeters =
    EARTH_RADIUS_METERS *
    toRadians(maxLongitude - minLongitude) *
    Math.cos(toRadians(averageLatitude));

  if (heightMeters <= 0 || widthMeters <= 0) {
    return 1;
  }

  return clamp(widthMeters / heightMeters, 0.65, 1.8);
}
