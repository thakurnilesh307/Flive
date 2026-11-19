import { PlaneGlyph } from "./icons";

interface Props {
  /** aircraft inside the map view (Boston feed + worldwide) */
  inView: number;
  /** airport numbers only when the map is over a prediction airport (Logan, JFK, Heathrow) */
  airportName: string | null;
  inbound: number;
  approach: number;
  worldEveryS: number;
}

const every = (s: number) => (s >= 120 ? `every ${Math.round(s / 60)} min` : `every ${s} s`);

export default function StatsCard({ inView, airportName, inbound, approach, worldEveryS }: Props) {
  return (
    <section className="panel stats" aria-label="Traffic summary">
      <div className="stat" title={`Aircraft inside the map view. Boston updates every 5 s, JFK and Heathrow every 10 s, the rest of the world ${every(worldEveryS)}.`}>
        <PlaneGlyph size={26} rotate={60} className="stat-icon blue" />
        <div><b>{inView.toLocaleString("en-US")}</b><span>In view</span></div>
      </div>
      {airportName && (
        <>
          <div className="stat" title={`Arriving at ${airportName} (my landing model, plus planes descending toward it)`}>
            <PlaneGlyph size={26} rotate={120} className="stat-icon cyan" />
            <div><b>{inbound}</b><span>Inbound to {airportName}</span></div>
          </div>
          <div className="stat" title={`Within 15 nm, below 5,000 ft and descending toward ${airportName} (estimated)`}>
            <PlaneGlyph size={26} rotate={150} className="stat-icon amber" />
            <div><b>{approach}</b><span>On approach</span></div>
          </div>
        </>
      )}
    </section>
  );
}
