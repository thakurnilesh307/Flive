import { useEffect, useState, type ReactNode } from "react";
import TopNav, { REPO } from "../about/TopNav";
import { DataTable, GroupedBars, Legend, LineChart, type Series } from "./charts";

const AIRPORT_COLOR = ["var(--s1)", "var(--s2)", "var(--s3)"];

interface Results {
  generated: string;
  airports: { icao: string; name: string }[];
  time_lost: Record<string, {
    days: string[]; flights: number; mean_min: number; median_min: number; over_5_pct: number;
    holding_pct: number; total_hours: number;
    by_traffic: { bucket: string; mean_min: number; flights: number }[];
    by_hour: { hour: number; mean_min: number; flights: number }[];
  }>;
  scheduler: Record<string, {
    quiet_floor_min: number; runway_choice_moved_pct: number;
    by_traffic: { bucket: string; hours: number; real_min: number; fcfs_min: number; optimizer_min: number; optimizer_runways_min: number }[];
  }>;
  transfer: Record<string, {
    straight_line_mae_min: number;
    old_rule: { precision_pct: number; recall_pct: number };
    rows: { days: number; eta_local: number | null; eta_transfer: number | null;
            arr_local_precision: number | null; arr_local_recall: number | null;
            arr_transfer_precision: number | null; arr_transfer_recall: number | null }[];
  }>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="doc-section"><h2>{title}</h2>{children}</section>;
}

function Figure({ n, title, sub, legend, children, table }: {
  n: number; title: string; sub?: string; legend?: ReactNode; children: ReactNode; table: ReactNode;
}) {
  return (
    <figure className="fig">
      <figcaption><span className="fig-num">Figure {n}</span><h3>{title}</h3>{sub && <p>{sub}</p>}</figcaption>
      {legend}
      {children}
      {table}
    </figure>
  );
}

const hourLabel = (h: number) => `${h}:00`;

export default function ResultsPage() {
  const [r, setR] = useState<Results | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    fetch("/results.json").then((x) => x.json()).then(setR).catch(() => setErr(true));
  }, []);

  return (
    <div className="about results">
      <TopNav here="results" />

      <div className="intro">
        <h1>Results</h1>
        <p>
          Flive records every plane around Boston Logan, New York JFK and London Heathrow. Over about five weeks
          that adds up to roughly 57,000 landings. I used them to answer three questions: how much time do arriving
          planes lose waiting for their turn, could a scheduler have done better than the real controllers, and can a
          model trained at some airports work at one it has never seen?
        </p>
        {r && <p className="meta">Data from {r.time_lost.KBOS.days[0]} to {r.time_lost.KBOS.days[1]}, from free public ADS-B feeds. Last updated {r.generated}.</p>}
      </div>

      <main className="results-body">
        {err && <p className="note">Couldn&apos;t load the results. Try reloading the page.</p>}
        {!r && !err && <p className="note">Loading...</p>}
        {r && <Body r={r} />}
      </main>
    </div>
  );
}

function Body({ r }: { r: Results }) {
  const aps = r.airports;
  const tl = r.time_lost;

  // 1. time lost vs traffic and by hour of day
  const traffic = tl[aps[0].icao].by_traffic.map((b) => b.bucket);
  const trafficSeries: Series[] = aps.map((a, i) => ({
    name: a.name, color: AIRPORT_COLOR[i],
    values: traffic.map((b) => tl[a.icao].by_traffic.find((x) => x.bucket === b)?.mean_min ?? null),
  }));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourSeries: Series[] = aps.map((a, i) => ({
    name: a.name, color: AIRPORT_COLOR[i],
    values: hours.map((h) => tl[a.icao].by_hour.find((x) => x.hour === h)?.mean_min ?? null),
  }));

  // 2. scheduler comparison, one panel per airport on a shared scale
  const schedNames = ["What really happened", "First come, first served", "Optimizer (reorder)", "Optimizer + runway choice"];
  const schedKeys = ["real_min", "fcfs_min", "optimizer_min", "optimizer_runways_min"] as const;
  const schedColor = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"];
  const schedMax = Math.max(...aps.flatMap((a) => r.scheduler[a.icao].by_traffic.flatMap((b) => schedKeys.map((k) => b[k]))));

  // 3. transfer controller
  const days = r.transfer[aps[0].icao].rows.map((x) => x.days);
  const tSeries = (icao: string, local: "eta_local" | "arr_local_precision", tr: "eta_transfer" | "arr_transfer_precision"): Series[] => [
    { name: "Local model", color: "var(--s1)", values: r.transfer[icao].rows.map((x) => x[local]) },
    { name: "Transfer model", color: "var(--s2)", values: r.transfer[icao].rows.map((x) => x[tr]) },
  ];
  const etaMax = Math.max(...aps.flatMap((a) => r.transfer[a.icao].rows.flatMap((x) => [x.eta_local ?? 0, x.eta_transfer ?? 0])));

  return (
    <>
      <Section id="time-lost" title="How much time arrivals lose">
        <p>
          For every landing I measured the time from crossing 40 nautical miles out to touchdown, and compared it
          with how long similar flights take when nobody is in the way (same direction, same runway, same size of
          plane). The difference is time spent holding, being vectored around, or slowed down to wait for a gap.
          Eurocontrol&apos;s performance reviews measure arrival delay the same way.
        </p>
        <table className="summary">
          <thead><tr><th>Airport</th><th>Landings</th><th>Lost per arrival</th><th>Median</th><th>Over 5 min</th><th>Total</th></tr></thead>
          <tbody>
            {aps.map((a) => (
              <tr key={a.icao}>
                <td>{a.name}</td>
                <td>{tl[a.icao].flights.toLocaleString()}</td>
                <td>{tl[a.icao].mean_min.toFixed(1)} min</td>
                <td>{tl[a.icao].median_min.toFixed(1)} min</td>
                <td>{Math.round(tl[a.icao].over_5_pct)}%</td>
                <td>{Math.round(tl[a.icao].total_hours)} h</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Figure n={1} title="The busier the hour, the more each arrival loses"
                sub="Average minutes lost per arrival, by how many planes landed within 30 minutes either side"
                legend={<Legend series={trafficSeries} kind="line" />}
                table={<DataTable caption="Minutes lost per arrival by landings that hour"
                                  head={["Landings that hour", ...aps.map((a) => a.name)]}
                                  rows={traffic.map((b, i) => [b, ...trafficSeries.map((s) => s.values[i]?.toFixed(1) ?? "-")])} />}>
          <LineChart x={traffic} series={trafficSeries} unit=" min" xTitle="Landings that hour" label="Minutes lost per arrival rises with traffic at all three airports" />
        </Figure>

        <Figure n={2} title="Time lost through the day"
                sub="Average minutes lost per arrival by local hour of landing (hours with fewer than 20 landings left out)"
                legend={<Legend series={hourSeries} kind="line" />}
                table={<DataTable caption="Minutes lost per arrival by local hour"
                                  head={["Local hour", ...aps.map((a) => a.name)]}
                                  rows={hours.map((h, i) => [hourLabel(h), ...hourSeries.map((s) => s.values[i]?.toFixed(1) ?? "-")])} />}>
          <LineChart x={hours.map(hourLabel)} series={hourSeries} unit=" min" xTitle="Local time" label="Minutes lost per arrival by hour of day" />
        </Figure>
        <p>
          Heathrow is the outlier. About {Math.round(tl.EGLL.holding_pct)}% of its arrivals fly a holding pattern, compared
          with {Math.round(tl.KBOS.holding_pct)}% at Logan and {Math.round(tl.KJFK.holding_pct)}% at JFK, and that&apos;s
          deliberate: Heathrow keeps planes circling in its &quot;stacks&quot; so the runways are never idle, giving up a
          few minutes per flight to land as many planes an hour as possible. Logan and JFK mostly absorb delay with
          turns and speed changes instead.
        </p>
      </Section>

      <Section id="scheduler" title="Could a scheduler do better?">
        <p>
          I replayed every real arrival through three schedulers. Each one lands the same planes on the same
          runways, at the rate those runways actually manage when there&apos;s a queue. First come, first served lands
          planes in the order they could arrive, each as soon as the runway allows. The optimizer can also swap
          planes by up to three places to cut the total delay (solved exactly). The last one can additionally move a
          plane to another runway that was in use for landings at the time.
        </p>
        <p>
          Real delay also includes time that has nothing to do with the queue, like a longer route or a slower plane,
          so for &quot;what really happened&quot; I subtracted the delay arrivals have even in quiet hours.
        </p>
        <Figure n={3} title="Minutes lost per arrival, real vs. three schedulers"
                sub="By how many planes landed that hour. All three panels use the same scale."
                legend={<Legend series={schedNames.map((n, i) => ({ name: n, color: schedColor[i] }))} kind="bar" />}
                table={<DataTable caption="Minutes lost per arrival, real (adjusted) vs. schedulers"
                                  head={["Airport · landings that hour", ...schedNames]}
                                  rows={aps.flatMap((a) => r.scheduler[a.icao].by_traffic.map((b) => [`${a.name} · ${b.bucket}`, ...schedKeys.map((k) => b[k].toFixed(1))]))} />}>
          <div className="multiples">
            {aps.map((a) => {
              const bt = r.scheduler[a.icao].by_traffic;
              return (
                <div key={a.icao} className="panel">
                  <h4>{a.name}</h4>
                  <GroupedBars groups={bt.map((b) => b.bucket)} unit=" min" yMax={schedMax} xTitle="Landings that hour"
                               label={`${a.name}: minutes lost per arrival, real vs. schedulers`}
                               series={schedNames.map((n, i) => ({ name: n, color: schedColor[i], values: bt.map((b) => b[schedKeys[i]]) }))} />
                </div>
              );
            })}
          </div>
        </Figure>
        <ul className="takeaways">
          <li>Reordering helps. In busy hours the optimizer cuts first-come delay by 12-38%, mostly by grouping heavy jets so fewer planes have to wait out the longer gaps behind them.</li>
          <li>At Logan, once the optimizer can also pick runways (it moved {r.scheduler.KBOS.runway_choice_moved_pct}% of arrivals), it slightly beats the real controllers in the busiest hours. In hours with 30-39 landings the controllers still win.</li>
          <li>JFK&apos;s controllers beat every scheduler, by about two minutes per arrival at the busiest times. Runway choice doesn&apos;t help because JFK&apos;s landing runways are already fully used. My guess is they do things the replay can&apos;t model, like tightening the gaps during a rush.</li>
          <li>Heathrow is the only place the schedulers find real room, over 2 minutes per arrival in its busiest hours, and most of that is the stack buffer it keeps on purpose.</li>
        </ul>
        <p className="caveat">
          Caveats: runways that cross or sit close together are treated as independent, any amount of delay can be
          absorbed, and the quiet-hour adjustment assumes a route takes as long in a rush as in a quiet hour. The
          replay is a yardstick, not an argument that a computer should run the tower.
        </p>
      </Section>

      <Section id="transfer" title="One model for any airport?">
        <p>
          A controller who moves from Boston to JFK brings general skills but has to learn the new layout and the
          neighbouring airports. I wanted to see if a model could do the same. The transfer model is trained on the
          other two airports, using only things measured relative to the airport (distance, height, speed, position
          against the runway in use), and then gets 0 to 7 days of the new one. The local model only ever sees the
          new airport. Both are tested on the same final 10 days.
        </p>
        <Figure n={4} title="Landing time: the general model works from day one"
                sub="Average error in minutes (lower is better)"
                legend={<Legend series={tSeries(aps[0].icao, "eta_local", "eta_transfer")} kind="line" />}
                table={<DataTable caption="Landing-time error (minutes) by days of the new airport's data"
                                  head={["Airport · days of local data", "Local model", "Transfer model"]}
                                  rows={aps.flatMap((a) => r.transfer[a.icao].rows.map((x) => [`${a.name} · ${x.days}`, x.eta_local?.toFixed(2) ?? "-", x.eta_transfer?.toFixed(2) ?? "-"]))} />}>
          <div className="multiples">
            {aps.map((a) => (
              <div key={a.icao} className="panel">
                <h4>{a.name}</h4>
                <LineChart x={days.map(String)} xValues={days} endLabels={false} series={tSeries(a.icao, "eta_local", "eta_transfer")} unit=" min" digits={2}
                           yMax={etaMax} xTitle="Days of local data" height={220} label={`${a.name}: landing-time error by days of local data`} />
              </div>
            ))}
          </div>
        </Figure>
        <Figure n={5} title="Is it landing here? That part needs local data"
                sub="Share of arrival predictions that were right (higher is better). The scale starts at 50%."
                legend={<Legend series={tSeries(aps[0].icao, "arr_local_precision", "arr_transfer_precision")} kind="line" />}
                table={<DataTable caption="Predictions right / real arrivals found (%), by days of the new airport's data"
                                  head={["Airport · days of local data", "Local: right / found", "Transfer: right / found"]}
                                  rows={aps.flatMap((a) => r.transfer[a.icao].rows.map((x) => [`${a.name} · ${x.days}`,
                                    x.arr_local_precision == null ? "-" : `${x.arr_local_precision}% / ${x.arr_local_recall}%`,
                                    x.arr_transfer_precision == null ? "-" : `${x.arr_transfer_precision}% / ${x.arr_transfer_recall}%`]))} />}>
          <div className="multiples">
            {aps.map((a) => (
              <div key={a.icao} className="panel">
                <h4>{a.name}</h4>
                <LineChart x={days.map(String)} xValues={days} endLabels={false} series={tSeries(a.icao, "arr_local_precision", "arr_transfer_precision")} unit="%" digits={0}
                           yMin={50} yMax={100} tickCount={5} xTitle="Days of local data" height={220} label={`${a.name}: share of right predictions by days of local data`} />
              </div>
            ))}
          </div>
        </Figure>
        <p>
          When a plane will land is mostly physics, which is the same everywhere, so the transfer model is as good
          as a local one from the first day and much better than a local model with only a day of data. At JFK the
          local model catches up after about three days. Whether a plane is landing here at all depends on the
          neighbours (where Newark, LaGuardia and Teterboro are and which way their traffic flows), which is exactly
          what the transfer model never saw. On day one at JFK about a third of its arrival calls are for planes
          landing somewhere else, and a local model needs about three days of data to learn the area. Not that
          different from a new controller.
        </p>
      </Section>

      <Section id="method" title="How I measured it">
        <ul>
          <li>Landings and runways come from the planes&apos; own position reports. Checked against about 20,000 OpenSky arrival records per airport, the detector finds 95-97% of landings, and 99-100% of what it finds are real.</li>
          <li>Every model is tested on days it never trained on. Positions a few seconds apart are nearly identical, so a random split would make the scores look better than they are.</li>
          <li>Runway rates, wake spacing and &quot;unimpeded&quot; times are measured from the data, not taken from textbooks.</li>
          <li>The code, and a longer write-up of every number, are on <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>.</li>
        </ul>
      </Section>
    </>
  );
}
