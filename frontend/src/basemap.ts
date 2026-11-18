import type { Map as GLMap } from "maplibre-gl";

// Recolor OpenFreeMap's grey "dark" style to Flive's navy palette and quiet the
// clutter (paths, rail, one-way arrows) so aircraft stay the focus.
const PAINT: Record<string, Record<string, string>> = {
  background: { "background-color": "#0a1222" },
  water: { "fill-color": "#050b16" },
  waterway: { "line-color": "#050b16" },
  landuse_residential: { "fill-color": "#0c1628" },
  landcover_wood: { "fill-color": "#0c1729" },
  landuse_park: { "fill-color": "#0c1729" },
  building: { "fill-color": "#0f1b31" },
  "aeroway-area": { "fill-color": "#101d34" },
  "aeroway-taxiway": { "line-color": "#24344f" },
  "aeroway-runway-casing": { "line-color": "#4a5d80" },
  "aeroway-runway": { "line-color": "#33445f" },
  highway_minor: { "line-color": "#0f1a2e" },
  highway_major_casing: { "line-color": "#1a2944" },
  highway_major_inner: { "line-color": "#131f37" },
  highway_major_subtle: { "line-color": "#182640" },
  highway_motorway_casing: { "line-color": "#243759" },
  highway_motorway_inner: { "line-color": "#192a48" },
  highway_motorway_subtle: { "line-color": "#1b2c4a" },
  boundary_state: { "line-color": "#22314d" },
  highway_name_other: { "text-color": "#46577a", "text-halo-color": "#0a1222" },
  highway_name_motorway: { "text-color": "#5a6c90", "text-halo-color": "#0a1222" },
  water_name: { "text-color": "#33476a", "text-halo-color": "#050b16" },
};

const HIDE = [
  "highway_path", "road_oneway", "road_oneway_opposite",
  "railway", "railway_dashline", "railway_minor", "railway_minor_dashline",
  "railway_transit", "railway_transit_dashline",
];

/** Quiet the clutter (both themes); in dark mode also recolour OpenFreeMap's grey
 *  "dark" style to Flive's navy. Light mode uses OpenFreeMap's "positron" as-is. */
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
    map.setPaintProperty(layer.id, "text-color", big ? "#b3c1da" : "#7f8faa");
    map.setPaintProperty(layer.id, "text-halo-color", "#0a1222");
    map.setPaintProperty(layer.id, "text-halo-width", 1.2);
  }
}
