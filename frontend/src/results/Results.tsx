import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "../components/icons";
import { DataTable, GroupedBars, Legend, LineChart, type Series } from "./charts";

const REPO = "https://github.com/thakurnilesh307/Flive";
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

function Figure({ title, sub, legend, children, table }: {
  title: string; sub?: string; legend?: ReactNode; children: ReactNode; table: ReactNode;
}) {
  return (
    <figure className="fig">
      <figcaption><h3>{title}</h3>{sub && <p>{sub}</p>}</figcaption>
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
      <header className="about-top">
        <a className="about-brand" href="/"><Logo size={30} /><span>Flive</span></a>
        <nav className="about-top-links">
          <a href="/about.html">About</a>
          <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a className="btn-primary small" href="/">Back to the map</a>
        </nav>
      </header>

      <div className="intro">
        <h1>Model vs. reality</h1>
        <p>
          Flive records every plane around Boston Logan, New York JFK and London Heathrow. Over about five weeks
          that&apos;s roughly 57,000 landings. This page asks three questions of that data: how much time do arriving
          planes lose waiting their turn, could a scheduler have done better than the real controllers, and can one
          model learn to work at an airport it has never seen?
        </p>
        {r && <p className="meta">Data: {r.time_lost.KBOS.days[0]} to {r.time_lost.KBOS.days[1]}, from free public ADS-B feeds. Updated {r.generated}.</p>}
      </div>

      <main className="results-body">
        {err && <p className="note">Couldn&apos;t load the results. Try reloading the page.</p>}
        {!r && !err && <p className="note">Loading the results…</p>}
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
          For every landing I measure the time from crossing 40 nautical miles out to touchdown, and compare it with
          how long similar flights take with nobody in the way: same direction, same runway, same size of plane. The
          difference is time spent holding, being steered around, or slowed down to wait for a gap. It&apos;s the same
          idea Europe&apos;s air traffic performance reviews use.
        </p>
        <div className="tiles">
          {aps.map((a, i) => (
            <div className="tile" key={a.icao}>
              <div className="tile-label"><span className="key key-line" style={{ background: AIRPORT_COLOR[i] }} aria-hidden="true" />{a.name}</div>
              <div className="tile-value">{tl[a.icao].mean_min.toFixed(1)} min</div>
              <div className="tile-sub">lost per arrival on average · {Math.round(tl[a.icao].total_hours)} hours over {tl[a.icao].flights.toLocaleString()} landings · {Math.round(tl[a.icao].over_5_pct)}% lose more than 5 min</div>
            </div>
          ))}
        </div>

        <Figure title="The busier the hour, the more each arrival loses"
                sub="Average minutes lost per arrival, by how many planes landed within 30 minutes either side"
                legend={<Legend series={trafficSeries} kind="line" />}
                table={<DataTable caption="Minutes lost per arrival by landings that hour"
                                  head={["Landings that hour", ...aps.map((a) => a.name)]}
                                  rows={traffic.map((b, i) => [b, ...trafficSeries.map((s) => s.values[i]?.toFixed(1) ?? "-")])} />}>
          <LineChart x={traffic} series={trafficSeries} unit=" min" xTitle="Landings that hour" label="Minutes lost per arrival rises with traffic at all three airports" />
        </Figure>

        <Figure title="Through the day"
                sub="Average minutes lost per arrival by local hour of landing (hours with fewer than 20 landings left out)"
                legend={<Legend series={hourSeries} kind="line" />}
                table={<DataTable caption="Minutes lost per arrival by local hour"
                                  head={["Local hour", ...aps.map((a) => a.name)]}
                                  rows={hours.map((h, i) => [hourLabel(h), ...hourSeries.map((s) => s.values[i]?.toFixed(1) ?? "-")])} />}>
          <LineChart x={hours.map(hourLabel)} series={hourSeries} unit=" min" xTitle="Local time" label="Minutes lost per arrival by hour of day" />
        </Figure>
        <p>
          Heathrow stands out: about {Math.round(tl.EGLL.holding_pct)}% of its arrivals fly a holding pattern, against{" "}
          {Math.round(tl.KBOS.holding_pct)}% at Logan and {Math.round(tl.KJFK.holding_pct)}% at JFK. That&apos;s on purpose.
          Heathrow keeps a queue of planes circling in its &quot;stacks&quot; so the runways never sit idle, trading minutes
          per flight for the most landings an hour. Logan and JFK mostly absorb delay with turns and speed changes.
        </p>
      </Section>

      <Section id="scheduler" title="Could a scheduler do better?">
        <p>
          I replayed every real arrival through three schedulers, each landing the same planes on the same runways at
          the pace those runways really manage when planes are queued:
        </p>
        <ul>
          <li><b>First come, first served:</b> planes land in the order they could arrive, each as soon as the runway allows.</li>
          <li><b>Optimizer:</b> planes may swap up to three places to cut the total delay (solved exactly, not guessed).</li>
          <li><b>Optimizer + runway choice:</b> it may also move a plane to another runway that was being used for landings at the time.</li>
        </ul>
        <p>
          Real delays also include time that has nothing to do with the queue, like a longer route or a slower plane.
          So &quot;what really happened&quot; has the delay real arrivals have even in quiet hours taken off, to compare like
          with like.
        </p>
        <Figure title="Minutes lost per arrival, real vs. three schedulers"
                sub="By how many planes landed that hour; the same scale in all three panels"
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
          <li><b>Reordering helps:</b> the optimizer cuts first-come delay by 12-38% in busy hours, mostly by grouping heavy jets so fewer planes wait out their longer gaps.</li>
          <li><b>Logan:</b> once it can also pick runways (it moved {r.scheduler.KBOS.runway_choice_moved_pct}% of arrivals), the optimizer edges out the real controllers in the busiest hours. In merely busy hours (30-39 landings), Logan&apos;s controllers still win.</li>
          <li><b>JFK&apos;s controllers beat every scheduler</b>, by about two minutes per arrival when it&apos;s busiest. Runway choice doesn&apos;t close the gap: JFK&apos;s landing runways are already used to the full. That points to things the replay can&apos;t model, like tightening gaps in a rush.</li>
          <li><b>Heathrow</b> is the one place the schedulers find room, over 2 minutes per arrival in its busiest hours. That&apos;s mostly the stack buffer it keeps on purpose.</li>
        </ul>
        <p className="caveat">
          Limits: runways that cross or sit close together are treated as independent, any delay can be absorbed, and
          the quiet-hour adjustment assumes a route takes as long in a rush as in a quiet hour. The replay is a yardstick,
          not a claim that a computer should run the tower.
        </p>
      </Section>

      <Section id="transfer" title="One model for any airport?">
        <p>
          A controller who moves from Boston to JFK brings general skills and has to learn the layout and the
          neighbours. I tested whether a model can do the same: train it only on things measured relative to the
          airport (distance, height, speed, position against the runway in use) at the <i>other</i> airports, then give
          it 0 to 7 days of the new one. The local model only ever sees the new airport. Both are tested on the same last
          10 days.
        </p>
        <Figure title="Landing time: the physics transfers"
                sub="Average error in minutes; lower is better"
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
        <Figure title="Is it landing here? The neighbourhood doesn't"
                sub="Share of predictions that were right (%); higher is better. The scale starts at 50%"
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
          When a plane will land is physics, and it&apos;s the same everywhere: the transfer model is as good as a local
          one from day one, and much better than a local model with only a day of data. Only at JFK does the local model catch up, after about three days. <i>Whether</i> a plane is landing here depends on the
          neighbours (where Newark, LaGuardia and Teterboro are, and which way their traffic flows), and that&apos;s
          exactly the local knowledge the transfer model doesn&apos;t get. On day one at JFK a third of its predictions
          go to planes landing somewhere else; a local model needs about three days of watching to learn the
          neighbourhood. Much like a new controller.
        </p>
      </Section>

      <Section id="method" title="How it's measured">
        <ul>
          <li>Landings and runways come from the planes&apos; own position reports, checked against about 20,000 OpenSky arrival records per airport: 95-97% found, and 99-100% of the landings found were real.</li>
          <li>All models are tested on days they never trained on, because positions seconds apart are near-duplicates and a random split would flatter them.</li>
          <li>Runway pace, wake spacing and &quot;unimpeded&quot; times are measured from the data, not assumed.</li>
          <li>The code and a longer write-up of every number are on <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a> (README: &quot;Time lost on arrival&quot;, &quot;First come, first served vs. what really happened&quot;, &quot;The transfer controller&quot;).</li>
        </ul>
      </Section>
    </>
  );
}
