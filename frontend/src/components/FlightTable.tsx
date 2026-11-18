import type { Derived } from "../status";
import { operatorFor } from "../airlines";
import { flightLabel, fmtAlt, fmtDist, fmtSpeed } from "../format";
import { describePosition, useAirports, type Airport } from "../airports";
import { ChevronIcon, PlaneGlyph } from "./icons";
import StatusPill from "./StatusPill";
import AirlineBadge from "./AirlineBadge";

function AirlineCell({ d }: { d: Derived }) {
  const op = operatorFor(d.a.callsign, d.a.registration, d.a.operator, d.a.operator_icao);
  return <span className="airline-cell"><AirlineBadge op={op} size={22} />{op.name}</span>;
}

export type Tab = "arrivals" | "departures" | "inview";

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  /** which tabs to show (Logan tabs only when the map is over Boston) */
  tabs: Tab[];
  counts: Record<Tab, number>;
  rows: Derived[];
  /** note shown on the right of the tab bar */
  note: string;
  searching: boolean;
  /** airports matching the search, shown above the aircraft */
  airports: Airport[];
  onAirport: (a: Airport) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  open: boolean;
  onToggle: () => void;
}

const TABS: { id: Tab; label: string; rotate: number }[] = [
  { id: "arrivals", label: "Logan arrivals", rotate: 120 },
  { id: "departures", label: "Logan departures", rotate: 30 },
  { id: "inview", label: "In view", rotate: 75 },
];

export default function FlightTable({ tab, onTab, tabs, counts, rows, note, searching, airports, onAirport, selectedId, onSelect, open, onToggle }: Props) {
  useAirports(); // re-render with "near X" positions once the airport list arrives
  return (
    <section className={`panel table-panel ${open ? "open" : ""}`} aria-label="Flight list">
      <div className="tabs" role="tablist">
        {searching ? (
          <span className="tab active">Search results <em>{rows.length + airports.length}</em></span>
        ) : (
          TABS.filter((t) => tabs.includes(t.id)).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => { onTab(t.id); if (!open) onToggle(); }}
            >
              <PlaneGlyph size={18} rotate={t.rotate} />
              {t.label} <em>{counts[t.id].toLocaleString("en-US")}</em>
            </button>
          ))
        )}
        <span className="tabs-note muted small">{note}</span>
        <button className="icon-btn ghost collapse" onClick={onToggle} aria-label={open ? "Collapse list" : "Expand list"}>
          <ChevronIcon size={20} className={open ? "" : "flip"} />
        </button>
      </div>

      {open && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Flight</th><th>Airline</th><th>Type</th>
                <th className="num">Altitude</th><th className="num">Speed</th>
                <th>Position</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {airports.map((ap) => (
                <tr
                  key={`ap-${ap.code}`}
                  className="airport-row"
                  onClick={() => onAirport(ap)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") onAirport(ap); }}
                >
                  <td className="strong">{ap.code}</td>
                  <td colSpan={5}>{ap.name}{ap.city && ap.city !== ap.name ? <span className="muted"> · {ap.city}</span> : null}</td>
                  <td className="muted">Airport · go there</td>
                </tr>
              ))}
              {rows.map((d) => (
                <tr
                  key={d.a.icao24}
                  className={d.a.icao24 === selectedId ? "selected" : ""}
                  onClick={() => onSelect(d.a.icao24)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") onSelect(d.a.icao24); }}
                >
                  <td className="strong">{flightLabel(d)}</td>
                  <td><AirlineCell d={d} /></td>
                  <td>{d.a.aircraft_type ?? "–"}</td>
                  <td className="num">{fmtAlt(d)}</td>
                  <td className="num">{fmtSpeed(d)}</td>
                  <td className="muted">{describePosition(d.a) ?? `${fmtDist(d)} from KBOS`}</td>
                  <td><StatusPill status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && airports.length === 0 && (
            <p className="empty muted">
              {searching ? "No flights or airports match that search." : "No aircraft in this list right now."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
