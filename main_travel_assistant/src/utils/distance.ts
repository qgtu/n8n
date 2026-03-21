/**
 * Haversine distance — great-circle distance between two lat/lng points.
 *
 * Production-grade: handles edge cases (antipodal, same point, ±180 wrap).
 * Returns distance in kilometres.
 */

const EARTH_RADIUS_KM = 6_371.0088; // WGS-84 mean radius

/** Convert degrees to radians */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate the great-circle distance between two points using the Haversine formula.
 *
 * @param lat1 Latitude of point 1 (degrees)
 * @param lng1 Longitude of point 1 (degrees)
 * @param lat2 Latitude of point 2 (degrees)
 * @param lng2 Longitude of point 2 (degrees)
 * @returns Distance in kilometres (rounded to 1 decimal)
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  // Clamp to [0, 1] to avoid NaN from floating-point overshoot
  const c = 2 * Math.atan2(Math.sqrt(Math.min(a, 1)), Math.sqrt(Math.max(1 - a, 0)));

  return Math.round(c * EARTH_RADIUS_KM * 10) / 10;
}

/**
 * Estimate travel duration on Vietnam roads based on haversine distance.
 *
 * Uses average speeds:
 *   - driving-car: ~50 km/h (Vietnam road average incl. urban + highway mix)
 *   - cycling-regular: ~15 km/h
 *   - foot-walking: ~5 km/h
 *
 * @returns Duration in minutes (rounded)
 */
export function estimateDuration(distanceKm: number, mode: string): number {
  const speeds: Record<string, number> = {
    'driving-car': 50,
    'cycling-regular': 15,
    'foot-walking': 5,
  };
  const speed = speeds[mode] || 50;
  return Math.round((distanceKm / speed) * 60);
}
