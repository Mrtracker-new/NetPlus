/**
 * World Vector Geometry & Map Projection Engine
 * =============================================
 * Cartographic Provenance:
 *   - Dataset: Natural Earth v5.1.1 (Admin 0 - Countries, 1:110m scale)
 *   - Source: https://www.naturalearthdata.com / Natural Earth Cultural Vectors
 *   - License: Public Domain / CC0 1.0 Universal
 *   - Coordinate System: WGS84 Geodetic Coordinates (Latitude [-90, +90], Longitude [-180, +180])
 *   - Projection: Equirectangular / Plate Carrée (Standard 720 x 360 SVG Canvas)
 *       X = (lng + 180) * (width / 360)   -> [0, 720]
 *       Y = (90 - lat) * (height / 180)   -> [0, 360]
 *   - Sovereign Country Features: 177 official country MultiPolygons / Polygons
 *
 * Visual Layer Hierarchy:
 *   Layer 1: Background & Graticule (Equator, Prime Meridian, 30° grid lines)
 *   Layer 2: Real Sovereign Country Geometries (177 sovereign countries)
 *   Layer 3: Network Traffic Arcs (Quadratic Bézier paths with logarithmic stroke weighting)
 *   Layer 4: Active Telemetry Particles & Origin/Destination Nodes
 */

import { GEO_COUNTRY_FEATURES, type GeoCountryFeature } from "./geoCountriesData";

export const MAP_WIDTH = 720;
export const MAP_HEIGHT = 360;

/**
 * Projects latitude and longitude coordinates into SVG canvas (x, y) coordinates.
 * Lat: [-90, 90] -> Y: [360, 0]
 * Lng: [-180, 180] -> X: [0, 720]
 */
export function projectGeo(lat: number, lng: number, width = MAP_WIDTH, height = MAP_HEIGHT): [number, number] {
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const clampedLng = Math.max(-180, Math.min(180, lng));

  const x = ((clampedLng + 180) / 360) * width;
  const y = ((90 - clampedLat) / 180) * height;
  return [Number(x.toFixed(2)), Number(y.toFixed(2))];
}

/**
 * Generates graticule grid lines (parallels & meridians at 30-degree increments).
 */
export function generateGraticulePaths(width = MAP_WIDTH, height = MAP_HEIGHT): string[] {
  const paths: string[] = [];

  // Parallels (Latitude lines from -60 to +60 in steps of 30)
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = projectGeo(lat, 0, width, height);
    paths.push(`M0 ${y} L${width} ${y}`);
  }

  // Meridians (Longitude lines from -150 to +150 in steps of 30)
  for (let lng = -150; lng <= 150; lng += 30) {
    const [x] = projectGeo(0, lng, width, height);
    paths.push(`M${x} 0 L${x} ${height}`);
  }

  return paths;
}

/**
 * Export Natural Earth 1:110m Sovereign Country Features
 */
export const COUNTRY_FEATURES = GEO_COUNTRY_FEATURES;
export { type GeoCountryFeature };
