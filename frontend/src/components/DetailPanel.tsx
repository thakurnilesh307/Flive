import { useEffect, useState } from "react";
import type { Derived } from "../status";
import { categoryLabel, operatorFor } from "../airlines";
import AirlineBadge from "./AirlineBadge";
import { flightLabel, fmtAgo, fmtAlt, fmtDist, fmtHeading, fmtSpeed, fmtVs } from "../format";
import { CloseIcon, LocateIcon, PlaneGlyph, RunwayIcon } from "./icons";
import StatusPill from "./StatusPill";

interface Props {
  d: Derived;
  serverNow: number;
  following: boolean;
  onToggleFollow: () => void;
  onClose: () => void;
}

interface Photo { src: string; link: string; photographer: string }
interface Extra { type_desc: string | null; aircraft_type: string | null; registration: string | null; photo: Photo | null }

/** Full type name + photo for the selected plane, from GET /api/aircraft/{icao24}. */
function useAircraftExtra(icao24: string) {
  const [extra, setExtra] = useState<{ id: string; data: Extra | null } | null>(null);
  useEffect(() => {
    let stop = false;
    fetch(`/api/aircraft/${encodeURIComponent(icao24)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!stop) setExtra({ id: icao24, data }); })
      .catch(() => { if (!stop) setExtra({ id: icao24, data: null }); });
    return () => { stop = true; };
  }, [icao24]);
  return extra?.id === icao24 ? { loading: false, data: extra.data } : { loading: true, data: null };
}

export default function DetailPanel({ d, serverNow, following, onToggleFollow, onClose }: Props) {
  const a = d.a;
  const op = operatorFor(a.callsign, a.registration, a.operator);
  const { loading, data: extra } = useAircraftExtra(a.icao24);
  const typeCode = a.aircraft_type ?? extra?.aircraft_type ?? null;
  const model = a.type_desc ?? extra?.type_desc ?? null;
  const reg = a.registration ?? extra?.registration ?? null;
  const photo = extra?.photo ?? null;
  const category = categoryLabel(a.category);
  const seenAgo = a.last_contact != null ? Math.max(0, serverNow - a.last_contact) : null;

  return (
    <aside className="panel detail" aria-label={`Details for ${flightLabel(d)}`}>
      <header className="detail-head">
        <AirlineBadge op={op} size={48} />
        <div className="detail-title">
          <h2>{flightLabel(d)}</h2>
          <p>{op.name}</p>
        </div>
        <button
          className={`icon-btn ghost follow-btn ${following ? "on" : ""}`}
          onClick={onToggleFollow}
          aria-pressed={following}
          aria-label={following ? "Stop following this plane" : "Follow this plane"}
          title={following ? "Following (drag the map to stop)" : "Follow this plane"}
        >
          <LocateIcon size={19} />
        </button>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close details">
          <CloseIcon size={20} />
        </button>
      </header>

      <div className={`hero ${photo ? "has-photo" : ""}`}>
        {photo
          ? <img className="hero-img" src={photo.src} alt={`Photo of ${reg ?? "this aircraft"}`} referrerPolicy="no-referrer" />
          : <PlaneGlyph size={120} rotate={a.track_deg ?? 45} className="hero-plane" />}
        <div className="hero-text">
          <div className="hero-type">{typeCode ?? "Unknown type"}</div>
          <div className="hero-sub">
            {[model, reg, category].filter(Boolean).join(" · ") || "Not in the aircraft database"}
          </div>
        </div>
        {photo ? (
          <a className="hero-credit" href={photo.link} target="_blank" rel="noopener noreferrer">
            © {photo.photographer} · Planespotters.net
          </a>
        ) : (
          <div className="hero-note">{loading ? "Looking for a photo…" : "No photo found"}</div>
        )}
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
          <div className="predict-title">Not built yet</div>
          <div className="muted small">My landing scheduler will fill this in</div>
        </div>
      </div>

      <footer className="detail-foot muted small">
        <span>ICAO {a.icao24.toUpperCase()}</span>
        <span>{seenAgo == null ? "" : `Last signal ${fmtAgo(seenAgo)}`}</span>
      </footer>
    </aside>
  );
}
