import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as GLMap } from "maplibre-gl";
import { useLiveFeed } from "./useLiveFeed";
import { derive, isArriving, type Derived } from "./status";
import { operatorFor } from "./airlines";
import { KBOS } from "./geo";
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
const byDistance = (x: Derived, y: Derived) => (x.distNm ?? 999) - (y.distNm ?? 999);

function matches(d: Derived, q: string): boolean {
  const a = d.a;
  const hay = [a.callsign, a.registration, a.aircraft_type, a.icao24, a.squawk,
    operatorFor(a.callsign, a.registration).name].filter(Boolean).join(" ").toUpperCase();
  return hay.includes(q);
}

export default function App() {
  const { snapshot, connected, clockSkew, trails, world, sendView, keepAircraft } = useLiveFeed();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("arrivals");
  const [tableOpen, setTableOpen] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const mapRef = useRef<GLMap | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const derived = useMemo(() => (snapshot?.aircraft ?? []).map(derive).sort(byDistance), [snapshot]);
  // Worldwide aircraft in view (server already removed the ones the Boston feed covers).
  const worldDerived = useMemo(() => (world?.aircraft ?? []).map(derive), [world]);
  const selected = derived.find((d) => d.a.icao24 === selectedId)
    ?? worldDerived.find((d) => d.a.icao24 === selectedId) ?? null;
  const serverNow = now / 1000 + clockSkew;
  const live = connected && snapshot != null && serverNow - snapshot.api_time < LIVE_MAX_AGE_S;

  // Ask the server to always include the selected plane, even when thinning would drop it.
  useEffect(() => { keepAircraft(selectedId); }, [selectedId, keepAircraft]);

  const q = query.trim().toUpperCase();
  const searchHits = useMemo(
    () => (q ? [...derived, ...worldDerived].filter((d) => matches(d, q)) : null),
    [derived, worldDerived, q],
  );
  const dimmed = useMemo(() => {
    if (!searchHits) return null;
    const hit = new Set(searchHits.map((d) => d.a.icao24));
    return new Set([...derived, ...worldDerived].map((d) => d.a.icao24).filter((id) => !hit.has(id)));
  }, [derived, worldDerived, searchHits]);

  const lists = useMemo(() => ({
    arrivals: derived.filter((d) => isArriving(d.status)),
    departures: derived.filter((d) => d.status === "departing"),
    all: derived,
  }), [derived]);
  const counts = { arrivals: lists.arrivals.length, departures: lists.departures.length, all: derived.length };

  const select = useCallback((id: string | null, pan = false) => {
    setSelectedId(id);
    if (id) setChatOpen(false);
    const map = mapRef.current;
    if (!id || !pan || !map) return;
    const d = derived.find((x) => x.a.icao24 === id) ?? worldDerived.find((x) => x.a.icao24 === id);
    if (d?.a.lat != null && d.a.lon != null && !map.getBounds().contains([d.a.lon, d.a.lat])) {
      map.easeTo({ center: [d.a.lon, d.a.lat], duration: 600 });
    }
  }, [derived, worldDerived]);

  const trail = selectedId ? trails.current.get(selectedId) ?? [] : [];
  const showDetail = selected != null && !chatOpen;

  // Starter questions; one uses a real aircraft so it always has an answer.
  const nearestAirborne = derived.find((d) => !d.a.on_ground && d.a.callsign);
  const suggestions = [
    "What's landing next?",
    "How many planes are on the ground?",
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
        onViewChange={sendView}
      />

      <TopBar
        query={query}
        onQuery={setQuery}
        onSubmit={() => { if (searchHits?.[0]) select(searchHits[0].a.icao24, true); }}
        live={live}
        now={now}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
      />

      <StatsCard
        tracked={derived.filter((d) => d.a.lat != null).length}
        inbound={lists.arrivals.length}
        approach={derived.filter((d) => d.status === "approach").length}
        worldInView={world ? world.totalInView : null}
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

      {showDetail && selected && <DetailPanel d={selected} serverNow={serverNow} onClose={() => setSelectedId(null)} />}
      {chatOpen && (
        <ChatPanel messages={chat} setMessages={setChat} suggestions={suggestions} onClose={() => setChatOpen(false)} />
      )}

      <FlightTable
        tab={tab}
        onTab={setTab}
        counts={counts}
        rows={searchHits ? searchHits.slice(0, MAX_SEARCH_ROWS) : lists[tab]}
        searching={searchHits != null}
        selectedId={selectedId}
        onSelect={(id) => select(id, true)}
        open={tableOpen}
        onToggle={() => setTableOpen((o) => !o)}
      />

      {!snapshot && <div className="loading panel">{connected ? "Waiting for first update…" : "Connecting to live feed…"}</div>}
      <div className="credit">
        Aircraft <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer">adsb.fi</a>
        {" · "}<a href="https://opensky-network.org" target="_blank" rel="noopener noreferrer">OpenSky Network</a>
        {" · "}Map <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>
        {" "}&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a>
        {" "}&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
      </div>
    </div>
  );
}
