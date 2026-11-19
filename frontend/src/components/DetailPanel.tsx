import { useEffect, useState } from "react";
import type { Derived } from "../status";
import { categoryLabel, operatorFor } from "../airlines";
import AirlineBadge from "./AirlineBadge";
import { byIcao, describePosition, useAirports } from "../airports";
import { clockAt, flightLabel, fmtAgo, fmtAlt, fmtDist, fmtHeading, fmtSpeed, fmtVs, minsUntil } from "../format";
import { CloseIcon, LocateIcon, PlaneGlyph, RunwayIcon } from "./icons";
import StatusPill from "./StatusPill";

interface Props {
  d: Derived;
  /** prediction airport whose feed this plane is in (Logan, JFK, Heathrow), or null */
  airportName: string | null;
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

export default function DetailPanel({ d, airportName, serverNow, following, onToggleFollow, onClose }: Props) {
  const a = d.a;
  const op = operatorFor(a.callsign, a.registration, a.operator, a.operator_icao);
  const { loading, data: extra } = useAircraftExtra(a.icao24);
  const typeCode = a.aircraft_type ?? extra?.aircraft_type ?? null;
  const model = a.type_desc ?? extra?.type_desc ?? null;
  const reg = a.registration ?? extra?.registration ?? null;
  const photo = extra?.photo ?? null;
  useAirports();
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
        <div><dt>Position</dt><dd className="pos">{describePosition(a) ?? `${fmtDist(d)} from ${a.airport ?? "KBOS"}`}</dd></div>
        <div><dt>Squawk</dt><dd>{a.squawk ?? "–"}</dd></div>
      </dl>

      <div className={`predict ${a.landing_at || a.takeoff_runway ? "has-eta" : ""}`}>
        <RunwayIcon size={30} className="predict-icon" />
        {a.landing_at && a.prediction === "global" ? (
          <div>
            <div className="muted small">
              Probably landing at {(a.landing_airport && byIcao(a.landing_airport)?.name) || a.landing_airport || "a nearby airport"}
            </div>
            <div className="predict-title">
              {minsUntil(a.landing_at, serverNow) < 1 ? "Landing now" : `In about ${minsUntil(a.landing_at, serverNow)} min`}
              <span className="muted"> · {clockAt(a.landing_at)}</span>
            </div>
            <div className="muted small">
              {a.landing_lo_at && a.landing_hi_at && a.landing_hi_at - a.landing_lo_at >= 60
                ? `Likely ${minsUntil(a.landing_lo_at, serverNow)} to ${minsUntil(a.landing_hi_at, serverNow)} min · `
                : ""}
              rough estimate: my global model, updated every 90 s
            </div>
            {a.landing_runway && <div className="predict-rwy">Lined up with runway <b>{a.landing_runway}</b></div>}
          </div>
        ) : a.landing_at ? (
          <div>
            <div className="muted small">Predicted landing at {airportName ?? "the airport"}</div>
            <div className="predict-title">
              {minsUntil(a.landing_at, serverNow) < 1 ? "Landing now" : `In about ${minsUntil(a.landing_at, serverNow)} min`}
              <span className="muted"> · {clockAt(a.landing_at)}</span>
            </div>
            <div className="muted small">
              {a.landing_lo_at && a.landing_hi_at && a.landing_hi_at - a.landing_lo_at >= 60
                ? `Likely ${minsUntil(a.landing_lo_at, serverNow)} to ${minsUntil(a.landing_hi_at, serverNow)} min · `
                : ""}
              my model, trained on past {airportName ?? ""} landings
            </div>
            {a.landing_runway && (
              <div className="predict-rwy">Probably runway <b>{a.landing_runway}</b> · {Math.round((a.landing_runway_p ?? 0) * 100)}% likely</div>
            )}
          </div>
        ) : a.takeoff_runway ? (
          <div>
            <div className="muted small">Predicted takeoff runway</div>
            <div className="predict-title">Runway {a.takeoff_runway}
              <span className="muted"> · {Math.round((a.takeoff_runway_p ?? 0) * 100)}% likely</span>
            </div>
            <div className="muted small">From where it&apos;s taxiing and which runways are in use</div>
          </div>
        ) : (
          <div>
            <div className="muted small">Predicted landing</div>
            <div className="predict-title">No prediction</div>
            <div className="muted small">
              {airportName
                ? <>Only for planes that look like they&apos;re landing at {airportName}</>
                : "Only for planes that look like they're coming down to land at an airport"}
            </div>
          </div>
        )}
      </div>

      <footer className="detail-foot muted small">
        <span>ICAO {a.icao24.toUpperCase()}</span>
        <span>{seenAgo == null ? "" : `Last signal ${fmtAgo(seenAgo)}`}</span>
      </footer>
    </aside>
  );
}
