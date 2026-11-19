import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as GLMap } from "maplibre-gl";
import { useLiveFeed } from "./useLiveFeed";
import { derive, deriveWorld, isArriving, type Derived } from "./status";
import { operatorFor } from "./airlines";
import { KBOS, distanceNm } from "./geo";
import type { BBox, LatLon } from "./types";

/** The airport the Logan-style tabs and stats are about right now. */
interface Focus { icao: string; name: string; pos: LatLon }
import { nearest, searchAirports, useAirports, type Airport } from "./airports";
import { applyTheme, initialTheme, type Theme } from "./theme";
import MapView from "./components/MapView";
import TopBar from "./components/TopBar";
import StatsCard from "./components/StatsCard";
import DetailPanel from "./components/DetailPanel";
import FlightTable, { type Tab } from "./components/FlightTable";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import { flightLabel } from "./format";
import { LocateIcon, MinusIcon, PlusIcon } from "./components/icons";

const LIVE_MAX_AGE_S = 30;
const MAX_SEARCH_ROWS = 100;
const MAX_VIEW_ROWS = 100;
const NEAR_AIRPORT_NM = 80;   // map centre within this of a prediction airport (and zoomed in) = "over" it
const NEAR_AIRPORT_ZOOM = 7;

/** Is a lon/lat inside a box whose east edge may be past 180 (unwrapped)? */
function inBox(lat: number, lon: number, [w, s, e, n]: BBox): boolean {
  if (lat < s || lat > n) return false;
  if (e - w >= 360) return true;
  return ((((lon - w) % 360) + 360) % 360) <= e - w;
}
const byDistance = (x: Derived, y: Derived) => (x.distNm ?? 999) - (y.distNm ?? 999);

function matches(d: Derived, q: string): boolean {
  const a = d.a;
  const hay = [a.callsign, a.registration, a.aircraft_type, a.icao24, a.squawk,
    operatorFor(a.callsign, a.registration, a.operator, a.operator_icao).name, a.type_desc].filter(Boolean).join(" ").toUpperCase();
  return hay.includes(q);
}

export default function App() {
  const { snapshot, connected, clockSkew, trails, world, sendView, keepAircraft, airportFeeds } = useLiveFeed();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggleTheme = () => setTheme((t) => {
    const next = t === "dark" ? "light" : "dark";
    applyTheme(next, true);   // remembered only once you choose
    return next;
  });
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("inview");
  const [view, setView] = useState<{ bbox: BBox | null; center: LatLon; zoom: number }>({ bbox: null, center: KBOS, zoom: 10 });
  const [tableOpen, setTableOpen] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const mapRef = useRef<GLMap | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Boston feed + other prediction airports' feeds (JFK, Heathrow): drawn at full rate, with
  // statuses relative to their own airport. The server leaves these out of the world rows.
  const derived = useMemo(() => {
    const out = (snapshot?.aircraft ?? []).map((a) => derive({ ...a, airport: "KBOS" }));
    const seen = new Set(out.map((d) => d.a.icao24));
    for (const f of airportFeeds) {
      for (const a of f.aircraft) if (!seen.has(a.icao24)) { seen.add(a.icao24); out.push(derive(a, f.pos)); }
    }
    return out.sort(byDistance);
  }, [snapshot, airportFeeds]);
  // Worldwide aircraft in view (server already removed the ones the Boston feed covers).
  const worldDerived = useMemo(() => (world?.aircraft ?? []).map(deriveWorld), [world]);
  const selected = derived.find((d) => d.a.icao24 === selectedId)
    ?? worldDerived.find((d) => d.a.icao24 === selectedId) ?? null;
  const serverNow = now / 1000 + clockSkew;
  const live = connected && snapshot != null && serverNow - snapshot.api_time < LIVE_MAX_AGE_S;

  // Ask the server to always include the selected plane, even when thinning would drop it.
  useEffect(() => { keepAircraft(selectedId); }, [selectedId, keepAircraft]);

  const q = query.trim().toUpperCase();
  const airportsReady = useAirports();
  const airportHits = useMemo(() => (q && airportsReady ? searchAirports(q) : []), [q, airportsReady]);
  const goToAirport = useCallback((ap: Airport) => {
    setQuery("");
    setSelectedId(null);
    mapRef.current?.flyTo({ center: [ap.lon, ap.lat], zoom: 10, duration: 1800 });
  }, []);
  // Airport under the middle of the map, shown in the top bar (replaces the old fixed "KBOS").
  const place = useMemo(() => {
    if (!airportsReady || view.zoom < NEAR_AIRPORT_ZOOM) return null;
    const hit = nearest(view.center);
    return hit && hit.dist < 40 ? { code: hit.a.code, name: hit.a.name } : null;
  }, [airportsReady, view]);
  const searchHits = useMemo(
    () => (q ? [...derived, ...worldDerived].filter((d) => matches(d, q)) : null),
    [derived, worldDerived, q],
  );
  const dimmed = useMemo(() => {
    if (!searchHits) return null;
    const hit = new Set(searchHits.map((d) => d.a.icao24));
    return new Set([...derived, ...worldDerived].map((d) => d.a.icao24).filter((id) => !hit.has(id)));
  }, [derived, worldDerived, searchHits]);

  // Arrival/departure tabs and stats only when the map is over an airport Flive predicts for.
  const focus = useMemo<Focus | null>(() => {
    if (view.zoom < NEAR_AIRPORT_ZOOM) return null;
    const options: Focus[] = [{ icao: "KBOS", name: "Logan", pos: KBOS }, ...airportFeeds.map((f) => ({ icao: f.icao, name: f.name, pos: f.pos }))];
    const best = options
      .map((o) => ({ o, d: distanceNm(view.center, o.pos) }))
      .filter((x) => x.d < NEAR_AIRPORT_NM)
      .sort((x, y) => x.d - y.d)[0];
    return best?.o ?? null;
  }, [view, airportFeeds]);
  const focusDerived = useMemo(() => (focus ? derived.filter((d) => d.a.airport === focus.icao) : []), [derived, focus]);

  // "In view": every plane inside the map view (Boston feed + worldwide), nearest to the centre first.
  const inView = useMemo(() => {
    const box = view.bbox;
    const pts = [...derived, ...worldDerived].filter((d) =>
      d.a.lat != null && d.a.lon != null && (box == null || inBox(d.a.lat, d.a.lon, box)));
    const dist = new Map(pts.map((d) => [d, distanceNm(view.center, [d.a.lat!, d.a.lon!])]));
    return pts.sort((x, y) => dist.get(x)! - dist.get(y)!);
  }, [derived, worldDerived, view]);
  const bostonInView = view.bbox ? derived.filter((d) => d.a.lat != null && d.a.lon != null && inBox(d.a.lat, d.a.lon, view.bbox!)).length : derived.length;
  // The server counts worldwide planes in the visible box before thinning, so this is the true total.
  const inViewTotal = world ? bostonInView + world.totalInView : inView.length;

  const lists = useMemo(() => ({
    // Arrivals: the model's predicted landings first (soonest first), then (Logan only) other
    // inbound planes. Around JFK/Heathrow "inbound" would also catch LaGuardia/Gatwick traffic.
    arrivals: focusDerived
      .filter((d) => d.a.landing_at != null || (focus?.icao === "KBOS" && isArriving(d.status)))
      .sort((x, y) => (x.a.landing_at ?? Infinity) - (y.a.landing_at ?? Infinity)),
    // Departures: planes taxiing out (with a predicted runway), then ones that just took off.
    departures: focusDerived
      .filter((d) => d.status === "departing" || d.a.takeoff_runway != null)
      .sort((x, y) => Number(x.status === "departing") - Number(y.status === "departing")),
    inview: inView.slice(0, MAX_VIEW_ROWS),
  }), [focusDerived, focus, inView]);
  const counts = { arrivals: lists.arrivals.length, departures: lists.departures.length, inview: inViewTotal };
  const activeTab: Tab = focus ? tab : "inview";
  const tableNote = activeTab === "inview"
    ? (inViewTotal > MAX_VIEW_ROWS ? `Nearest ${MAX_VIEW_ROWS} to the map centre` : "Nearest to the map centre first")
    : activeTab === "arrivals"
      ? "Sorted by predicted landing time · runway and time are my model's guesses"
      : activeTab === "departures"
      ? "Taxiing out (with predicted runway), then just departed"
      : "Statuses are my best guess from position and speed";

  // Selecting a plane always (re)starts following it; MapView flies the camera there.
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) { setChatOpen(false); setFollow(true); }
  }, []);

  const trail = selectedId ? trails.current.get(selectedId) ?? [] : [];
  const showDetail = selected != null && !chatOpen;

  // Starter questions; one uses a real aircraft so it always has an answer.
  const nearestAirborne = derived.find((d) => !d.a.on_ground && d.a.callsign);
  const suggestions = [
    "What's landing next?",
    "How busy is Heathrow right now?",
    nearestAirborne ? `Tell me about ${flightLabel(nearestAirborne)}` : "Which airlines are around right now?",
  ];

  return (
    <div className={`app ${showDetail || chatOpen ? "has-detail" : ""} ${tableOpen ? "table-open" : ""}`}>
      <MapView
        aircraft={derived}
        world={worldDerived}
        selectedId={selectedId}
        dimmed={dimmed}
        trail={trail}
        clockSkew={clockSkew}
        onSelect={(id) => select(id)}
        onMapReady={(m) => { mapRef.current = m; }}
        onViewChange={(bbox, center, zoom) => { sendView(bbox); setView({ bbox, center, zoom }); }}
        follow={follow}
        onFollowChange={setFollow}
        theme={theme}
      />

      <TopBar
        query={query}
        onQuery={setQuery}
        onSubmit={() => {
          // An exact airport code ("JFK") or nothing else matching -> go to the airport.
          const ap = airportHits[0];
          const exactAirport = ap && (ap.iata === q || ap.icao === q);
          if (ap && (exactAirport || !searchHits?.length)) goToAirport(ap);
          else if (searchHits?.[0]) select(searchHits[0].a.icao24);
        }}
        place={place}
        theme={theme}
        onToggleTheme={toggleTheme}
        live={live}
        now={now}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
      />

      <StatsCard
        inView={inViewTotal}
        airportName={focus?.name ?? null}
        inbound={lists.arrivals.length}
        approach={focusDerived.filter((d) => d.status === "approach" && (focus?.icao === "KBOS" || d.a.landing_at != null)).length}
        worldEveryS={world?.nextUpdateS ?? 90}
      />

      <div className="map-controls">
        <div className="zoom-group">
          <button className="icon-btn" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><PlusIcon /></button>
          <button className="icon-btn" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><MinusIcon /></button>
        </div>
        <button className="icon-btn solo" onClick={() => mapRef.current?.flyTo({ center: [KBOS[1], KBOS[0]], zoom: 10 })} aria-label="Center on Logan">
          <LocateIcon />
        </button>
      </div>

      {showDetail && selected && <DetailPanel d={selected} airportName={selected.a.airport === "KBOS" ? "Logan" : airportFeeds.find((f) => f.icao === selected.a.airport)?.name ?? null} serverNow={serverNow} following={follow} onToggleFollow={() => setFollow((f) => !f)} onClose={() => setSelectedId(null)} />}
      {chatOpen && (
        <ChatPanel messages={chat} setMessages={setChat} suggestions={suggestions} onClose={() => setChatOpen(false)} />
      )}

      <FlightTable
        tab={activeTab}
        onTab={setTab}
        tabs={focus ? ["arrivals", "departures", "inview"] : ["inview"]}
        airportName={focus?.name ?? null}
        counts={counts}
        note={tableNote}
        rows={searchHits ? searchHits.slice(0, MAX_SEARCH_ROWS) : lists[activeTab]}
        searching={searchHits != null}
        airports={airportHits}
        onAirport={goToAirport}
        selectedId={selectedId}
        onSelect={(id) => select(id)}
        open={tableOpen}
        onToggle={() => setTableOpen((o) => !o)}
        serverNow={serverNow}
      />

      {!snapshot && <div className="loading panel">{connected ? "Waiting for first update…" : "Connecting to live feed…"}</div>}
      <div className="credit">
        Aircraft <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer">adsb.fi</a>
        {" · "}<a href="https://opensky-network.org" target="_blank" rel="noopener noreferrer">OpenSky Network</a>
        {" · "}Photos <a href="https://www.planespotters.net" target="_blank" rel="noopener noreferrer">Planespotters.net</a>
        {" · "}Map <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>
        {" "}&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a>
        {" "}&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
      </div>
    </div>
  );
}
