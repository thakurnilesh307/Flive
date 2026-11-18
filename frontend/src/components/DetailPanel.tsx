import type { Derived } from "../status";
import { badgeHue, categoryLabel, operatorFor } from "../airlines";
import { flightLabel, fmtAgo, fmtAlt, fmtDist, fmtHeading, fmtSpeed, fmtVs } from "../format";
import { CloseIcon, PlaneGlyph, RunwayIcon } from "./icons";
import StatusPill from "./StatusPill";

interface Props {
  d: Derived;
  serverNow: number;
  onClose: () => void;
}

export default function DetailPanel({ d, serverNow, onClose }: Props) {
  const a = d.a;
  const op = operatorFor(a.callsign, a.registration);
  const category = categoryLabel(a.category);
  const seenAgo = a.last_contact != null ? Math.max(0, serverNow - a.last_contact) : null;

  return (
    <aside className="panel detail" aria-label={`Details for ${flightLabel(d)}`}>
      <header className="detail-head">
        <div className="badge" style={{ "--hue": badgeHue(op.code) } as React.CSSProperties}>
          {op.code}
        </div>
        <div className="detail-title">
          <h2>{flightLabel(d)}</h2>
          <p>{op.name}</p>
        </div>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close details">
          <CloseIcon size={20} />
        </button>
      </header>

      <div className="hero">
        <PlaneGlyph size={120} rotate={a.track_deg ?? 45} className="hero-plane" />
        <div className="hero-type">{a.aircraft_type ?? "Unknown type"}</div>
        <div className="hero-sub">
          {[a.registration, category].filter(Boolean).join(" · ") || "No registration data"}
        </div>
        <div className="hero-note">Aircraft photos coming soon</div>
      </div>

      <div className="detail-status">
        <StatusPill status={d.status} large />
        <span className="muted small">estimated</span>
      </div>

      <dl className="metrics">
        <div><dt>Altitude</dt><dd>{fmtAlt(d)}</dd></div>
        <div><dt>Groundspeed</dt><dd>{fmtSpeed(d)}</dd></div>
        <div><dt>Track</dt><dd>{fmtHeading(d)}</dd></div>
        <div><dt>Vertical speed</dt><dd>{fmtVs(d)}</dd></div>
        <div><dt>From KBOS</dt><dd>{fmtDist(d)}</dd></div>
        <div><dt>Squawk</dt><dd>{a.squawk ?? "–"}</dd></div>
      </dl>

      <div className="predict">
        <RunwayIcon size={30} className="predict-icon" />
        <div>
          <div className="muted small">Predicted landing</div>
          <div className="predict-title">Runway &amp; ETA coming soon</div>
          <div className="muted small">Arrives with the landing scheduler</div>
        </div>
      </div>

      <footer className="detail-foot muted small">
        <span>ICAO {a.icao24.toUpperCase()}</span>
        <span>{seenAgo == null ? "" : `Last signal ${fmtAgo(seenAgo)}`}</span>
      </footer>
    </aside>
  );
}
