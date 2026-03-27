// Voronoi Faction Zone Layer for Leaflet
// Computes Voronoi tessellation from faction POI points and renders
// semi-transparent colored polygons on the player screen map.

import { Delaunay } from "d3-delaunay";

declare const L: typeof import("leaflet");

export interface FactionZone {
  name: string;
  color: string;
  points: number[][]; // [[y, x], ...] in vault/Leaflet CRS.Simple coordinates
}

/**
 * Creates a Leaflet LayerGroup containing Voronoi faction zone polygons.
 *
 * @param factionZones - Array of factions with their POI locations
 * @param bounds - Map bounds as [minY, minX, maxY, maxX]
 * @param fillOpacity - Opacity for zone fills (default 0.2)
 * @returns L.LayerGroup with faction polygons, or null if insufficient data
 */
export function createVoronoiFactionLayer(
  factionZones: FactionZone[],
  bounds: number[],
  fillOpacity = 0.2
): L.LayerGroup | null {
  // Collect all points, tracking which faction each belongs to
  const allPoints: [number, number][] = [];
  const factionIndex: number[] = [];

  factionZones.forEach((zone, fi) => {
    zone.points.forEach(([y, x]) => {
      // d3-delaunay uses [x, y] coordinate order
      allPoints.push([x, y]);
      factionIndex.push(fi);
    });
  });

  // Need at least 2 points from 2+ factions to be meaningful
  if (allPoints.length < 2) return null;
  const uniqueFactions = new Set(factionIndex);
  if (uniqueFactions.size < 2) return null;

  // Compute Voronoi diagram
  // bounds: [minY, minX, maxY, maxX] → d3 expects [xmin, ymin, xmax, ymax]
  const [minY, minX, maxY, maxX] = bounds;
  const delaunay = Delaunay.from(allPoints);
  const voronoi = delaunay.voronoi([minX, minY, maxX, maxY]);

  const polygons: L.Layer[] = [];

  for (let i = 0; i < allPoints.length; i++) {
    const cellPolygon = voronoi.cellPolygon(i);
    if (!cellPolygon) continue;

    const fi = factionIndex[i];
    const zone = factionZones[fi];

    // Convert [x, y] back to [lat, lng] (= [y, x]) for Leaflet CRS.Simple
    const latLngs: [number, number][] = cellPolygon.map(
      ([x, y]) => [y, x] as [number, number]
    );

    const poly = L.polygon(latLngs, {
      color: zone.color,
      fillColor: zone.color,
      fillOpacity,
      weight: 1,
      opacity: 0.4,
    });

    poly.bindTooltip(zone.name, { sticky: true });
    polygons.push(poly);
  }

  return L.layerGroup(polygons);
}

/**
 * Creates a custom Leaflet control showing a faction color legend.
 */
export function createFactionLegend(
  factionZones: FactionZone[]
): L.Control {
  const Legend = L.Control.extend({
    options: { position: "bottomleft" as L.ControlPosition },

    onAdd() {
      const container = L.DomUtil.create("div", "faction-legend");

      const title = L.DomUtil.create("div", "faction-legend-title", container);
      title.textContent = "Factions";

      // Deduplicate (in case multiple zone entries share a faction name)
      const seen = new Set<string>();
      factionZones.forEach((zone) => {
        if (seen.has(zone.name)) return;
        seen.add(zone.name);

        const item = L.DomUtil.create("div", "faction-legend-item", container);

        const swatch = L.DomUtil.create("span", "faction-legend-swatch", item);
        swatch.style.backgroundColor = zone.color;

        const label = L.DomUtil.create("span", "faction-legend-label", item);
        label.textContent = zone.name;
      });

      // Prevent map interactions when clicking on the legend
      L.DomEvent.disableClickPropagation(container);

      return container;
    },
  });

  return new Legend();
}
