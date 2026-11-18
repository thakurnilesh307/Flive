import type { Derived } from "../status";
import { operatorFor } from "../airlines";
import { flightLabel, fmtAlt, fmtDist, fmtSpeed } from "../format";
import { ChevronIcon, PlaneGlyph } from "./icons";
import StatusPill from "./StatusPill";
import AirlineBadge from "./AirlineBadge";

function AirlineCell({ d }: { d: Derived }) {
  const op = operatorFor(d.a.callsign, d.a.registration, d.a.operator);
  return <span className="airline-cell"><AirlineBadge op={op} size={22} />{op.name}</span>;
}

export type Tab = "arrivals" | "departures" | "all";

interface Props {
  tab: Tab;
  onTab: (t: Tab) => void;
  counts: Record<Tab, number>;
  rows: Derived[];
  searching: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  open: boolean;
  onToggle: () => void;
}

const TABS: { id: Tab; label: string; rotate: number }[] = [
  { id: "arrivals", label: "Arrivals", rotate: 120 },
  { id: "departures", label: "Departures", rotate: 30 },
  { id: "all", label: "All traffic", rotate: 75 },
];

export default function FlightTable({ tab, onTab, counts, rows, searching, selectedId, onSelect, open, onToggle }: Props) {
  return (
    <section className={`panel table-panel ${open ? "open" : ""}`} aria-label="Flight list">
      <div className="tabs" role="tablist">
        {searching ? (
          <span className="tab active">Search results <em>{rows.length}</em></span>
        ) : (
          TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? "active" : ""}`}
              onClick={() => { onTab(t.id); if (!open) onToggle(); }}
            >
              <PlaneGlyph size={18} rotate={t.rotate} />
              {t.label} <em>{counts[t.id]}</em>
            </button>
          ))
        )}
        <span className="tabs-note muted small">Statuses are my best guess from position and speed</span>
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
                <th className="num">From KBOS</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
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
                  <td className="num">{fmtDist(d)}</td>
                  <td><StatusPill status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="empty muted">
              {searching ? "No aircraft match that search." : "No aircraft in this list right now."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
