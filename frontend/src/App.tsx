import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type L from "leaflet";
import { useLiveFeed } from "./useLiveFeed";
import { derive, isArriving, type Derived } from "./status";
import { operatorFor } from "./airlines";
import { KBOS } from "./geo";
import MapView from "./components/MapView";
import TopBar from "./components/TopBar";
import StatsCard from "./components/StatsCard";
import DetailPanel from "./components/DetailPanel";
import FlightTable, { type Tab } from "./components/FlightTable";
import { LocateIcon, MinusIcon, PlusIcon } from "./components/icons";

const LIVE_MAX_AGE_S = 30;
const byDistance = (x: Derived, y: Derived) => (x.distNm ?? 999) - (y.distNm ?? 999);

function matches(d: Derived, q: string): boolean {
  const a = d.a;
  const hay = [a.callsign, a.registration, a.aircraft_type, a.icao24, a.squawk,
    operatorFor(a.callsign, a.registration).name].filter(Boolean).join(" ").toUpperCase();
  return hay.includes(q);
}

export default function App() {
  const { snapshot, connected, clockSkew, trails } = useLiveFeed();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("arrivals");
  const [tableOpen, setTableOpen] = useState(true);
  const [now, setNow] = useState(Date.now());
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const derived = useMemo(() => (snapshot?.aircraft ?? []).map(derive).sort(byDistance), [snapshot]);
  const selected = derived.find((d) => d.a.icao24 === selectedId) ?? null;
  const serverNow = now / 1000 + clockSkew;
  const live = connected && snapshot != null && serverNow - snapshot.api_time < LIVE_MAX_AGE_S;

  const q = query.trim().toUpperCase();
  const searchHits = useMemo(() => (q ? derived.filter((d) => matches(d, q)) : null), [derived, q]);
  const dimmed = useMemo(
    () => (searchHits ? new Set(derived.filter((d) => !searchHits.includes(d)).map((d) => d.a.icao24)) : null),
    [derived, searchHits],
  );

  const lists = useMemo(() => ({
    arrivals: derived.filter((d) => isArriving(d.status)),
    departures: derived.filter((d) => d.status === "departing"),
    all: derived,
  }), [derived]);
  const counts = { arrivals: lists.arrivals.length, departures: lists.departures.length, all: derived.length };

  const select = useCallback((id: string | null, pan = false) => {
    setSelectedId(id);
    if (!id || !pan || !mapRef.current) return;
    const d = derived.find((x) => x.a.icao24 === id);
    if (d?.a.lat != null && d.a.lon != null) {
      mapRef.current.panInside([d.a.lat, d.a.lon], { padding: [120, 120] });
    }
  }, [derived]);

  const trail = selectedId ? trails.current.get(selectedId) ?? [] : [];

  return (
    <div className={`app ${selected ? "has-detail" : ""} ${tableOpen ? "table-open" : ""}`}>
      <MapView
        aircraft={derived}
        selectedId={selectedId}
        dimmed={dimmed}
        trail={trail}
        clockSkew={clockSkew}
        onSelect={(id) => select(id)}
        onMapReady={(m) => { mapRef.current = m; }}
      />

      <TopBar
        query={query}
        onQuery={setQuery}
        onSubmit={() => { if (searchHits?.[0]) select(searchHits[0].a.icao24, true); }}
        live={live}
        now={now}
      />

      <StatsCard
        tracked={derived.filter((d) => d.a.lat != null).length}
        inbound={lists.arrivals.length}
        approach={derived.filter((d) => d.status === "approach").length}
      />

      <div className="map-controls">
        <div className="zoom-group">
          <button className="icon-btn" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><PlusIcon /></button>
          <button className="icon-btn" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><MinusIcon /></button>
        </div>
        <button className="icon-btn solo" onClick={() => mapRef.current?.setView(KBOS, 10)} aria-label="Center on Logan">
          <LocateIcon />
        </button>
      </div>

      {selected && <DetailPanel d={selected} serverNow={serverNow} onClose={() => setSelectedId(null)} />}

      <FlightTable
        tab={tab}
        onTab={setTab}
        counts={counts}
        rows={searchHits ?? lists[tab]}
        searching={searchHits != null}
        selectedId={selectedId}
        onSelect={(id) => select(id, true)}
        open={tableOpen}
        onToggle={() => setTableOpen((o) => !o)}
      />

      {!snapshot && <div className="loading panel">{connected ? "Waiting for first update…" : "Connecting to live feed…"}</div>}
      <div className="credit">
        Aircraft <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer">adsb.fi</a>
        {" · "}Map <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>
        {" "}&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a>
        {" "}&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
      </div>
    </div>
  );
}
