import { useEffect, useState } from "react";
import type { Derived } from "../status";
import { categoryLabel, operatorFor } from "../airlines";
import AirlineBadge from "./AirlineBadge";
import { byIcao, describePosition, useAirports } from "../airports";
import { clockAt, flightLabel, fmtAgo, fmtAlt, fmtDist, fmtHeading, fmtSpeed, fmtVs, minsUntil } from "../format";
import { CloseIcon, LocateIcon } from "./icons";
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

/** "in 4 min (14:32)", or "landing now" */
function when(at: number, serverNow: number) {
  const m = minsUntil(at, serverNow);
  return m < 1 ? "landing now" : `in ${m} min (${clockAt(at)})`;
}

function range(d: Derived, serverNow: number) {
  const { landing_lo_at: lo, landing_hi_at: hi } = d.a;
  return lo && hi && hi - lo >= 60 ? `probably ${minsUntil(lo, serverNow)}-${minsUntil(hi, serverNow)} min. ` : "";
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
        <AirlineBadge op={op} size={36} />
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
          <LocateIcon size={17} />
        </button>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close details">
          <CloseIcon size={18} />
        </button>
      </header>

      <figure className="aircraft">
        {photo && <img src={photo.src} alt={`Photo of ${reg ?? "this aircraft"}`} referrerPolicy="no-referrer" />}
        <figcaption className="aircraft-text">
          <div className="aircraft-type">{typeCode ?? "unknown type"}</div>
          <div className="aircraft-sub">
            {[model, reg, category].filter(Boolean).join(", ") || "not in the aircraft database"}
          </div>
          {photo ? (
            <a className="aircraft-credit" href={photo.link} target="_blank" rel="noopener noreferrer">
              photo © {photo.photographer} / Planespotters.net
            </a>
          ) : (
            <span className="aircraft-credit">{loading ? "looking for a photo..." : "no photo found"}</span>
          )}
        </figcaption>
      </figure>

      <div className="detail-status">
        <StatusPill status={d.status} large />
        <span className="muted small">(guessed from position and speed)</span>
      </div>

      <dl className="metrics">
        <div><dt>Altitude</dt><dd>{fmtAlt(d)}</dd></div>
        <div><dt>Groundspeed</dt><dd>{fmtSpeed(d)}</dd></div>
        <div><dt>Track</dt><dd>{fmtHeading(d)}</dd></div>
        <div><dt>Vertical speed</dt><dd>{fmtVs(d)}</dd></div>
        <div><dt>Position</dt><dd className="pos">{describePosition(a) ?? `${fmtDist(d)} from ${a.airport ?? "KBOS"}`}</dd></div>
        <div><dt>Squawk</dt><dd>{a.squawk ?? "-"}</dd></div>
      </dl>

      <div className={`predict ${a.landing_at || a.takeoff_runway ? "has-eta" : ""}`}>
        {a.landing_at && a.prediction === "global" ? (
          <>
            <div className="predict-label">
              Landing at {(a.landing_airport && byIcao(a.landing_airport)?.name) || a.landing_airport || "a nearby airport"}?
            </div>
            <div className="predict-title">{when(a.landing_at, serverNow)}</div>
            <div className="muted small">
              {range(d, serverNow)}Rough guess from the global model (updates every 90 s).
            </div>
            {a.landing_runway && <div className="predict-rwy">Lined up with runway <b>{a.landing_runway}</b></div>}
          </>
        ) : a.landing_at ? (
          <>
            <div className="predict-label">Predicted landing at {airportName ?? "the airport"}</div>
            <div className="predict-title">{when(a.landing_at, serverNow)}</div>
            <div className="muted small">
              {range(d, serverNow)}Model trained on past {airportName ?? ""} landings.
            </div>
            {a.landing_runway && (
              <div className="predict-rwy">Runway <b>{a.landing_runway}</b> ({Math.round((a.landing_runway_p ?? 0) * 100)}% sure)</div>
            )}
          </>
        ) : a.takeoff_runway ? (
          <>
            <div className="predict-label">Predicted takeoff runway</div>
            <div className="predict-title">
              {a.takeoff_runway} <span className="muted small">({Math.round((a.takeoff_runway_p ?? 0) * 100)}% sure)</span>
            </div>
            <div className="muted small">Based on where it's taxiing and which runways are in use.</div>
          </>
        ) : (
          <>
            <div className="predict-label">Predicted landing</div>
            <div className="predict-title">none</div>
            <div className="muted small">
              {airportName
                ? `I only predict planes that look like they're landing at ${airportName}.`
                : "I only predict planes that look like they're coming down to land somewhere."}
            </div>
          </>
        )}
      </div>

      <footer className="detail-foot muted small">
        <span>hex {a.icao24.toUpperCase()}</span>
        <span>{seenAgo == null ? "" : `last signal ${fmtAgo(seenAgo)}`}</span>
      </footer>
    </aside>
  );
}
