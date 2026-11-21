import type { Map as GLMap } from "maplibre-gl";

// Recolor OpenFreeMap's "dark" style to Flive's slate greys and quiet the
// clutter (paths, rail, one-way arrows) so aircraft stay the focus.
const PAINT: Record<string, Record<string, string>> = {
  background: { "background-color": "#12171d" },
  water: { "fill-color": "#0a0e13" },
  waterway: { "line-color": "#0a0e13" },
  landuse_residential: { "fill-color": "#151a20" },
  landcover_wood: { "fill-color": "#141a1f" },
  landuse_park: { "fill-color": "#141a1f" },
  building: { "fill-color": "#181e25" },
  "aeroway-area": { "fill-color": "#1a2028" },
  "aeroway-taxiway": { "line-color": "#29313b" },
  "aeroway-runway-casing": { "line-color": "#4f5a67" },
  "aeroway-runway": { "line-color": "#36404c" },
  highway_minor: { "line-color": "#181e25" },
  highway_major_casing: { "line-color": "#222a33" },
  highway_major_inner: { "line-color": "#1b2129" },
  highway_major_subtle: { "line-color": "#1f262e" },
  highway_motorway_casing: { "line-color": "#2a333d" },
  highway_motorway_inner: { "line-color": "#202830" },
  highway_motorway_subtle: { "line-color": "#212931" },
  boundary_state: { "line-color": "#28303a" },
  highway_name_other: { "text-color": "#4e5967", "text-halo-color": "#12171d" },
  highway_name_motorway: { "text-color": "#5f6a78", "text-halo-color": "#12171d" },
  water_name: { "text-color": "#36414d", "text-halo-color": "#0a0e13" },
};

const HIDE = [
  "highway_path", "road_oneway", "road_oneway_opposite",
  "railway", "railway_dashline", "railway_minor", "railway_minor_dashline",
  "railway_transit", "railway_transit_dashline",
];

/** Quiet the clutter (both themes); in dark mode also recolour OpenFreeMap's grey
 *  "dark" style to Flive's slate greys. Light mode uses OpenFreeMap's "positron" as-is. */
export function restyleBasemap(map: GLMap, theme: "dark" | "light" = "dark") {
  for (const layer of HIDE) if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", "none");
  for (const layer of ["place_village", "place_suburb", "place_other"]) {
    if (map.getLayer(layer)) map.setLayerZoomRange(layer, 12, 24);
  }
  if (map.getLayer("highway_name_other")) map.setLayerZoomRange("highway_name_other", 13, 24);
  if (theme === "light") return;
  for (const [layer, props] of Object.entries(PAINT)) {
    if (!map.getLayer(layer)) continue;
    for (const [prop, value] of Object.entries(props)) {
      map.setPaintProperty(layer, prop as Parameters<GLMap["setPaintProperty"]>[1], value);
    }
  }
  for (const layer of map.getStyle().layers ?? []) {
    if (!layer.id.startsWith("place_")) continue;
    const big = layer.id === "place_city" || layer.id === "place_city_large";
    map.setPaintProperty(layer.id, "text-color", big ? "#b8c0ca" : "#818b97");
    map.setPaintProperty(layer.id, "text-halo-color", "#12171d");
    map.setPaintProperty(layer.id, "text-halo-width", 1.2);
  }
}
