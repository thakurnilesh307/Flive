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
        <span>In view</span><b>{inView.toLocaleString("en-US")}</b>
      </div>
      {airportName && (
        <>
          <div className="stat" title={`Arriving at ${airportName} (my landing model, plus planes descending toward it)`}>
            <span>Inbound to {airportName}</span><b>{inbound}</b>
          </div>
          <div className="stat" title={`Within 15 nm, below 5,000 ft and descending toward ${airportName} (estimated)`}>
            <span>On approach</span><b>{approach}</b>
          </div>
        </>
      )}
    </section>
  );
}
