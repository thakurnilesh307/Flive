import { useEffect, useState, type ReactNode } from "react";
import { Logo, PlaneGlyph, SparkIcon } from "../components/icons";

const REPO = "https://github.com/thakurnilesh307/Flive";

const SECTIONS = [
  ["what", "What you're looking at"],
  ["data", "Where the data comes from"],
  ["pipeline", "Signal to screen"],
  ["smooth", "Why planes glide"],
  ["status", "Guessing what a plane is doing"],
  ["ask-flive", "Ask Flive, the AI"],
  ["roadmap", "The prediction roadmap"],
  ["privacy", "Privacy & fair use"],
  ["stack", "Built with"],
  ["faq", "FAQ"],
  ["glossary", "Glossary"],
] as const;

function Section({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="doc-section">
      <p className="kicker">{kicker}</p>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Collapsible technical detail, so the plain-language story reads on its own. */
function Dev({ children, title = "For developers" }: { children: ReactNode; title?: string }) {
  return (
    <details className="dev">
      <summary><span className="dev-tag">&lt;/&gt;</span>{title}</summary>
      <div className="dev-body">{children}</div>
    </details>
  );
}

function PipelineDiagram() {
  const box = (x: number, label: string, sub: string, accent = false) => (
    <g transform={`translate(${x} 0)`}>
      <rect width="150" height="78" rx="12" className={accent ? "d-box d-accent" : "d-box"} />
      <text x="75" y="34" className="d-title">{label}</text>
      <text x="75" y="56" className="d-sub">{sub}</text>
    </g>
  );
  const arrow = (x: number, label: string) => (
    <g transform={`translate(${x} 39)`}>
      <line x1="4" y1="0" x2="46" y2="0" className="d-line" markerEnd="url(#arrow)" />
      <text x="25" y="-8" className="d-small">{label}</text>
    </g>
  );
  return (
    <figure className="diagram">
      <svg viewBox="0 0 860 120" role="img" aria-label="Aircraft broadcast to volunteer receivers, adsb.fi aggregates, the Flive server polls every 5 seconds and pushes to browsers">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" className="d-head" />
          </marker>
        </defs>
        <g transform="translate(5 20)">
          {box(0, "Aircraft", "ADS-B radio, 1090 MHz")}
          {arrow(150, "radio")}
          {box(200, "Receivers", "volunteers' antennas")}
          {arrow(350, "internet")}
          {box(400, "adsb.fi", "combines all feeds")}
          {arrow(550, "every 5 s")}
          {box(600, "Flive server", "one poller", true)}
        </g>
        <g transform="translate(755 59)">
          <line x1="0" y1="0" x2="40" y2="0" className="d-line" markerEnd="url(#arrow)" />
          <text x="18" y="-12" className="d-small">live push</text>
          <text x="54" y="6" className="d-title" textAnchor="start">You</text>
        </g>
      </svg>
      <figcaption>Every visitor shares the same feed: the server asks adsb.fi once, then pushes the result to everyone.</figcaption>
    </figure>
  );
}

function AskDiagram() {
  return (
    <figure className="diagram">
      <svg viewBox="0 0 760 210" role="img" aria-label="Your question goes to the Flive server, the language model asks for tools, the server runs them on live data, and the model writes an answer from the results">
        <defs>
          <marker id="arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" className="d-head" />
          </marker>
        </defs>
        <rect x="10" y="66" width="140" height="78" rx="12" className="d-box" />
        <text x="80" y="100" className="d-title">You</text>
        <text x="80" y="122" className="d-sub">"What's landing next?"</text>

        <rect x="300" y="66" width="160" height="78" rx="12" className="d-box d-accent" />
        <text x="380" y="100" className="d-title">Flive server</text>
        <text x="380" y="122" className="d-sub">runs tools on live data</text>

        <rect x="600" y="10" width="150" height="70" rx="12" className="d-box" />
        <text x="675" y="40" className="d-title">Language model</text>
        <text x="675" y="61" className="d-sub">local, via Ollama</text>

        <rect x="600" y="130" width="150" height="70" rx="12" className="d-box" />
        <text x="675" y="160" className="d-title">Live snapshot</text>
        <text x="675" y="181" className="d-sub">aircraft in memory</text>

        <line x1="152" y1="95" x2="296" y2="95" className="d-line" markerEnd="url(#arrow2)" />
        <text x="224" y="86" className="d-small">1 question</text>
        <line x1="296" y1="118" x2="152" y2="118" className="d-line" markerEnd="url(#arrow2)" />
        <text x="224" y="136" className="d-small">5 answer</text>

        <line x1="462" y1="80" x2="596" y2="45" className="d-line" markerEnd="url(#arrow2)" />
        <text x="520" y="50" className="d-small">2 "call landing_sequence"</text>
        <line x1="462" y1="128" x2="596" y2="162" className="d-line" markerEnd="url(#arrow2)" />
        <text x="520" y="168" className="d-small">3 run tool</text>
        <line x1="596" y1="62" x2="462" y2="96" className="d-line d-dash" markerEnd="url(#arrow2)" />
        <text x="560" y="96" className="d-small">4 results → model writes reply</text>
      </svg>
      <figcaption>The model never browses the web or answers from memory. It can only ask Flive's server for specific facts.</figcaption>
    </figure>
  );
}

export default function About() {
  const [active, setActive] = useState<string>("what");

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    document.querySelectorAll(".doc-section").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <div className="about">
      <header className="about-top">
        <a className="about-brand" href="/"><Logo size={30} /><span>Flive</span></a>
        <nav className="about-top-links">
          <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a className="btn-primary small" href="/">Open live map</a>
        </nav>
      </header>

      <div className="hero-block">
        <div className="hero-copy">
          <p className="kicker">About the project</p>
          <h1>Live air traffic around Boston Logan, explained.</h1>
          <p className="lede">
            Flive shows every plane broadcasting its position within about 40 nautical miles of Boston Logan
            airport, updated every few seconds. This page explains where that data comes from, how the map
            works, and how the built-in AI answers questions, in plain English first and with technical detail
            for developers underneath.
          </p>
          <div className="hero-actions">
            <a className="btn-primary" href="/"><PlaneGlyph size={18} rotate={60} /> Open the live map</a>
            <a className="btn-ghost" href="#ask-flive"><SparkIcon size={17} /> How the AI works</a>
          </div>
          <p className="audience">
            <span className="tag tag-plain">Plain English</span> sections read on their own.
            {" "}<span className="tag tag-dev">&lt;/&gt; For developers</span> boxes open the code-level details.
          </p>
        </div>
      </div>

      <div className="doc-layout">
        <nav className="toc" aria-label="On this page">
          <p>On this page</p>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={active === id ? "on" : ""}>{label}</a>
          ))}
        </nav>

        <main className="doc">
          <Section id="what" kicker="The map" title="What you're looking at">
            <p>
              Each <b>plane icon</b> is a real aircraft, pointed in the direction it's moving. Grey, smaller icons are
              planes on the ground at Logan. Click any plane (or a row in the list) to see its airline, aircraft type,
              altitude, speed and a dashed trail of where it has been since you opened the page.
            </p>
            <ul className="legend">
              <li><span className="dot green" /> <b>On approach</b>: close to Logan, low and descending toward it.</li>
              <li><span className="dot blue" /> <b>Inbound</b>: further out, descending and heading toward Logan.</li>
              <li><span className="dot amber" /> <b>Departing</b>: climbing out and heading away.</li>
              <li><span className="dot violet" /> <b>En route</b>: flying nearby but not obviously arriving or leaving.</li>
              <li><span className="dot grey" /> <b>On ground / taxiing</b>: on the airport surface.</li>
            </ul>
            <p>
              Zoom out and the map becomes a <b>globe with every tracked aircraft on Earth</b>. Planes near Boston update
              every 5 seconds. Everywhere else updates less often (about every 90 seconds) and glides in between, so the
              whole world stays moving without overloading the free data services.
            </p>
            <p>
              These labels are <b>educated guesses</b> from each plane&apos;s position and motion, not official flight
              plans. The section on <a href="#status">guessing what a plane is doing</a> explains exactly how they&apos;re made.
            </p>
          </Section>

          <Section id="data" kicker="The data" title="Where the data comes from">
            <p>
              Most aircraft carry a transponder that broadcasts <b>ADS-B</b> messages: short radio packets with the plane&apos;s
              identity, GPS position, altitude, speed and direction, sent several times a second. Since 2020 the US has
              required it in most controlled airspace, which covers nearly all airliners around Boston.
            </p>
            <p>
              Anyone with a cheap antenna can receive these signals. Thousands of volunteers do, and share what they hear
              with community networks. Flive uses <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer">adsb.fi</a>,
              one of those networks, which combines the volunteers&apos; feeds into one live picture. When a plane&apos;s own
              position isn&apos;t available, receivers can sometimes work it out from tiny differences in when the signal
              arrives at different antennas (called multilateration, or MLAT).
            </p>
            <p>
              For the rest of the world, Flive uses the <a href="https://opensky-network.org" target="_blank" rel="noopener noreferrer">OpenSky Network</a>,
              a research network that offers a whole-planet snapshot in one request. It allows a limited number of requests per
              day, which is why the worldwide view refreshes about every 90 seconds instead of every 5.
            </p>
            <p>
              What Flive does <b>not</b> have: where a flight came from or is going, gate, delays or passenger information.
              Those come from airline schedules, not from the radio signal.
            </p>
            <Dev>
              <p>
                <code>adsb_feed.py</code> polls <code>opendata.adsb.fi/api/v3/lat/…/lon/…/dist/40</code> every 5 s with a
                descriptive User-Agent. adsb.fi allows 1 request/second per IP and counts failed requests against that
                limit, so errors and HTTP 429 trigger exponential backoff (10 s → 300 s, honoring <code>Retry-After</code>).
              </p>
              <p>
                The response is readsb JSON. It&apos;s converted to Flive&apos;s snapshot format with SI units internally
                (metres, m/s); feet, knots and fpm exist only for display. Callsigns, registrations and type codes are
                stripped to <code>[A-Z0-9-]</code> and length-capped on the server, because all provider data is treated as
                untrusted.
              </p>
              <pre>{`{"fetched_at": 1794650000.0, "api_time": 1794650000.0, "aircraft": [
  {"icao24": "a1b2c3", "callsign": "JBU317", "lat": 42.36, "lon": -71.01,
   "baro_alt_m": 1066.8, "on_ground": false, "velocity_ms": 92.6,
   "track_deg": 41.0, "vert_rate_ms": -3.8, "category": 4,
   "aircraft_type": "A320", "registration": "N123JB", ...}]}`}</pre>
              <p>
                Why not adsb.lol (the original plan)? Its keyless tier allows 500 requests/day, and a 5 s poll needs
                ~17,000. adsb.fi and adsb.lol share the readsb format, so switching is one environment variable
                (<code>ADSB_URL</code>, plus <code>ADSB_API_KEY</code> if needed).
              </p>
            </Dev>
          </Section>

          <Section id="pipeline" kicker="Architecture" title="From radio signal to your screen">
            <PipelineDiagram />
            <p>
              Your browser never talks to adsb.fi directly. Flive&apos;s server fetches the data once every 5 seconds and pushes
              it to every open page over a live connection. That&apos;s fairer to the volunteer network, because a thousand
              visitors cost it the same as one.
            </p>
            <Dev>
              <ul>
                <li><code>server.py</code> (FastAPI) runs one background poller task and keeps the latest snapshot in memory.</li>
                <li>Snapshots are broadcast over a WebSocket at <code>/ws</code>. New viewers get the latest snapshot immediately.</li>
                <li>Every third snapshot (every 15 s) is appended to <code>logan_*.jsonl</code>. These logs are the training and evaluation data for the prediction work below.</li>
                <li>The React + TypeScript frontend (Vite) is served as static files from the same server.</li>
                <li><b>Worldwide:</b> a second poller fetches OpenSky <code>/states/all</code> (4 credits per call; every 90 s with an account, 15 min anonymously) into an in-memory 5° grid. Each page sends its map bounds over the WebSocket and gets only the aircraft in view as compact arrays, capped at 2,000 and thinned evenly when zoomed out (whole world ≈ 160 KB instead of ≈ 700 KB). The selected plane is always included. World data is never logged.</li>
                <li><b>Rendering:</b> MapLibre GL draws aircraft as GPU symbol layers (one recolorable SDF plane icon, rotated by track), so thousands of planes stay smooth; globe projection when zoomed out.</li>
              </ul>
            </Dev>
          </Section>

          <Section id="smooth" kicker="Tracking" title="Why planes glide instead of jumping">
            <p>
              New positions arrive every 5 seconds, which would make planes hop across the map. Between updates, Flive
              moves each plane forward along its current direction at its current speed, a technique sailors and pilots
              call <b>dead reckoning</b>. When the next real position arrives, the plane snaps to it. The correction is
              usually too small to notice.
            </p>
            <p>
              If a plane goes quiet (no signal for 30 seconds), its icon fades. When it disappears from the feed, it&apos;s removed.
            </p>
            <Dev>
              <p>
                <code>MapView.tsx</code> runs a 500 ms timer. For each airborne aircraft it computes elapsed time since the
                position&apos;s own timestamp (<code>time_position</code>), corrected for browser/server clock skew, and
                projects the position using flat-earth maths (accurate over a few seconds). Projection is capped at 20 s so a
                stale aircraft never drifts far. Trails are kept in the browser only (last ~10 minutes per aircraft).
              </p>
            </Dev>
          </Section>

          <Section id="status" kicker="Estimates" title="How Flive guesses what a plane is doing">
            <p>
              The radio signal doesn&apos;t say &quot;I&apos;m about to land&quot;. So Flive looks at three things: how far the plane is
              from Logan, whether it&apos;s pointed toward or away from the airport, and whether it&apos;s climbing or descending.
              Simple rules turn those into a label.
            </p>
            <table className="rules">
              <thead><tr><th>Label</th><th>Rule of thumb</th></tr></thead>
              <tbody>
                <tr><td><span className="dot green" /> On approach</td><td>Within 15 nm, below 5,000 ft, pointed at Logan, and descending (or already below 2,000 ft)</td></tr>
                <tr><td><span className="dot blue" /> Inbound</td><td>Within 40 nm, below 18,000 ft, pointed at Logan, descending</td></tr>
                <tr><td><span className="dot amber" /> Departing</td><td>Within 25 nm, climbing, and pointed away from Logan (or still very close to it)</td></tr>
                <tr><td><span className="dot violet" /> En route</td><td>Anything airborne that doesn&apos;t match the above</td></tr>
              </tbody>
            </table>
            <p>
              Rules like this are quick and easy to explain, but they get fooled. A small plane heading for nearby Hanscom
              or Norwood airport can look &quot;inbound&quot; to Logan. Replacing these guesses with real detection of landings and
              take-offs is the next big step (see <a href="#roadmap">the roadmap</a>).
            </p>
            <Dev>
              <p>
                Implemented in <code>frontend/src/status.ts</code> (map) and mirrored in <code>traffic.py</code> (AI tools) so both
                agree. &quot;Pointed at Logan&quot; means the aircraft&apos;s track is within 45° of the bearing to KBOS; &quot;away&quot; means more
                than 120° off. Descending/climbing means a vertical rate beyond ±250 fpm.
              </p>
            </Dev>
          </Section>

          <Section id="ask-flive" kicker="The AI" title="Ask Flive: an AI that only answers from live data">
            <p>
              Ask Flive lets you ask questions in normal language, such as &quot;What&apos;s landing next?&quot;, &quot;How busy is Heathrow?&quot; or
              &quot;Where is DLH400 right now?&quot;
              It&apos;s powered by a <b>large language model</b> (LLM): software trained on huge amounts of text to predict and write
              language. On their own, LLMs are confident guessers. Ask one about planes over Boston and it will happily make
              something up.
            </p>
            <p>
              So Ask Flive doesn&apos;t let the model answer from memory. Instead it uses <b>tool calling</b>: the model can only
              ask Flive&apos;s server for specific facts (&quot;give me the landing order&quot;), the server looks them up in the live
              data, and the model writes its reply from those results. If the data doesn&apos;t contain the answer, for example
              where a flight is going, it&apos;s instructed to say Flive doesn&apos;t know.
            </p>
            <AskDiagram />
            <p>
              Under each answer you&apos;ll see which lookups it used (&quot;Checked landing order&quot;), so you can tell it came from the
              data. It&apos;s still an AI, so it can occasionally phrase something wrong. The map is the source of truth.
            </p>
            <p>
              The model runs <b>locally</b>, on the same machine as Flive&apos;s server, through an open-source tool called
              <a href="https://ollama.com" target="_blank" rel="noopener noreferrer"> Ollama</a>. Your questions aren&apos;t sent
              to an outside AI company, and visitors don&apos;t need to install anything.
            </p>
            <Dev title="For developers: tools, loop and guardrails">
              <p>The model (default <code>qwen3:8b</code>, set by <code>OLLAMA_MODEL</code>) gets seven tools, defined in <code>ask.py</code>: four for Boston and three worldwide:</p>
              <table className="rules">
                <thead><tr><th>Tool</th><th>Returns</th></tr></thead>
                <tbody>
                  <tr><td><code>traffic_summary</code></td><td>Counts: total, airborne, on ground, by estimated status</td></tr>
                  <tr><td><code>list_aircraft(status?, airline?, limit?)</code></td><td>Aircraft sorted by distance, with altitude, speed, distance, direction from KBOS</td></tr>
                  <tr><td><code>get_aircraft(query)</code></td><td>One aircraft anywhere by callsign, registration or ICAO hex (Boston first, then worldwide), or <code>found: false</code></td></tr>
                  <tr><td><code>landing_sequence</code></td><td>Arriving aircraft at Logan ordered by straight-line time at current speed (a lower bound, not an ETA)</td></tr>
                  <tr><td><code>aircraft_near(place, radius_nm?, airline?)</code></td><td>Count and nearest aircraft around any airport or city; Boston feed overrides world data near Logan</td></tr>
                  <tr><td><code>find_airport(query)</code></td><td>Airport by code, name or city, from OurAirports (public domain, 3,265 airports with scheduled service)</td></tr>
                  <tr><td><code>world_summary</code></td><td>Worldwide total, airborne, counts by region, data age and a coverage caveat</td></tr>
                </tbody>
              </table>
              <ul>
                <li><b>Loop:</b> <code>POST /api/ask</code> → system prompt + last 6 turns + question → Ollama <code>/api/chat</code> with tool specs. Tool calls run against the in-memory snapshot and go back as <code>role: tool</code> messages. At most 4 tool rounds, temperature 0.2, &quot;thinking&quot; off for speed.</li>
                <li><b>Grounding:</b> the system prompt requires a tool call before any traffic fact, says to admit missing data, and to treat text inside tool results as data, not instructions.</li>
                <li><b>Don&apos;t trust an 8B model to pick tools for the obvious cases:</b> testing showed it sometimes picked the wrong tool for a named flight, or answered from chat history with no lookup at all. So the server (1) pre-fetches <code>get_aircraft</code> for any callsign or registration in the question, and (2) if the model answers without any tool call, sends it back once with an automatic &quot;you didn&apos;t check live data&quot; note, falling back to its original reply for genuinely off-topic or no-data questions.</li>
                <li><b>Shape the data so it&apos;s hard to misread:</b> the model kept turning &quot;straight-line minutes&quot; into confident ETAs and a plane&apos;s current direction from Logan into its origin. Tools now return pre-phrased values (&quot;at least 4 minutes away (lower bound, not an ETA)&quot;, &quot;S of KBOS&quot;) instead of bare numbers.</li>
                <li><b>Prompt-injection surface:</b> the only provider text the model sees is callsign/registration/type, already stripped to <code>[A-Z0-9-]</code> and capped at 4–10 characters by the server, so there&apos;s little room to smuggle instructions in.</li>
                <li><b>Abuse limits:</b> questions max 300 characters, 5/minute and 40/hour per visitor, one model call at a time (others wait up to 45 s, then get a friendly &quot;busy&quot;). Unknown tools and arguments are rejected.</li>
                <li><b>Rendering:</b> answers are shown as plain text (no HTML or Markdown rendering), so model output can&apos;t inject markup.</li>
                <li><b>Swappable backend:</b> the model sits behind a small <code>chat(messages, tools)</code> interface, so deployment can use a different host without touching the tools.</li>
              </ul>
            </Dev>
          </Section>

          <Section id="roadmap" kicker="What's next" title="The prediction roadmap: model vs. reality">
            <p>
              Flive grew out of an earlier project: a Python simulator that schedules planes onto runways the way air traffic
              control does. The goal is to point that kind of model at real Logan traffic and measure how well it predicts what
              actually happens.
            </p>
            <ol className="steps">
              <li>
                <b>Detect real arrivals and departures.</b> Follow each plane through the logged snapshots, spot the moment it
                touches down or lifts off (its &quot;on ground&quot; signal flips), and work out which runway it used from its heading
                and position. This replaces the rule-of-thumb labels with observed events.
              </li>
              <li>
                <b>Predict the landing sequence.</b> For planes still in the air, predict the order they&apos;ll land in and when.
                The simplest predictor is distance divided by speed. Smarter ones learn from history, such as how long planes
                at a given distance and altitude usually take to land, given which runways are in use.
              </li>
              <li>
                <b>Score it against reality.</b> Every night, compare predictions with what actually happened, using both
                Flive&apos;s own detected landings and official arrival records from OpenSky. Results are reported honestly,
                including where the model is wrong.
              </li>
            </ol>
            <Dev title="For developers: data and evaluation plan">
              <ul>
                <li><b>Training data:</b> the 15 s JSONL snapshot logs, segmented into per-flight tracks keyed by <code>icao24</code> + callsign.</li>
                <li><b>Event labels:</b> touchdown/liftoff from <code>on_ground</code> transitions; runway assignment by matching final-approach track and position to Logan&apos;s runway headings and thresholds.</li>
                <li><b>Baseline:</b> straight-line time-to-go (distance / groundspeed). Any learned model has to beat it to count.</li>
                <li><b>Candidate learned model:</b> regression of time-to-touchdown on distance, altitude, speed, vertical rate, bearing and active runway configuration, validated on held-out days.</li>
                <li><b>Metrics:</b> mean absolute error of predicted landing time (minutes) at fixed horizons (e.g. 5, 10, 20 min out), plus sequence agreement (rank correlation of predicted vs. actual order).</li>
                <li><b>Ground truth:</b> nightly OpenSky <code>/flights/arrival</code> and <code>/departure</code> queries for the previous day (OAuth2 client credentials, separate credit budget).</li>
              </ul>
            </Dev>
          </Section>

          <Section id="privacy" kicker="Responsibility" title="Privacy & fair use">
            <p>
              <b>About you:</b> Flive has no accounts, no cookies, no ads and no analytics. Ask Flive conversations live only
              in your browser tab. The server uses your question to answer it and doesn&apos;t save it.
            </p>
            <p>
              <b>About aircraft:</b> everything shown is broadcast openly by the aircraft themselves and already public on
              many flight-tracking sites. Flive shows only what&apos;s in the signal, which is typically the airline callsign,
              registration and aircraft type, with no owner or passenger information.
            </p>
            <p>
              <b>About the data network:</b> adsb.fi is run by volunteers. Flive polls gently (once every 5 seconds for all
              visitors combined), backs off when asked to, and credits adsb.fi on every page.
            </p>
          </Section>

          <Section id="stack" kicker="Under the hood" title="Built with">
            <div className="stack-grid">
              <div><h3>Data</h3><p>adsb.fi open data (Boston, 5 s), OpenSky Network (worldwide, ~90 s; arrivals for validation planned)</p></div>
              <div><h3>Server</h3><p>Python 3.11, FastAPI, WebSockets, requests, python-dotenv</p></div>
              <div><h3>Frontend</h3><p>React, TypeScript, Vite, MapLibre GL (globe + GPU aircraft layers), Inter</p></div>
              <div><h3>Map</h3><p>OpenFreeMap vector tiles, © OpenMapTiles, © OpenStreetMap contributors, restyled navy</p></div>
              <div><h3>AI</h3><p>Ollama running an open-weights LLM locally, with tool calling</p></div>
              <div><h3>Source</h3><p><a href={REPO} target="_blank" rel="noopener noreferrer">github.com/thakurnilesh307/Flive</a></p></div>
            </div>
            <Dev title="For developers: run it yourself">
              <pre>{`python -m pip install -r requirements.txt
cd frontend; npm install; npm run build; cd ..
# optional, for Ask Flive:
ollama pull qwen3:8b
python -m uvicorn server:app      # http://127.0.0.1:8000`}</pre>
              <p>Endpoints: <code>GET /ws</code> (WebSocket snapshots), <code>POST /api/ask</code>, <code>GET /api/ask/status</code>.</p>
            </Dev>
          </Section>

          <Section id="faq" kicker="Questions" title="FAQ">
            <div className="faq">
              <details><summary>Why can&apos;t I find a specific flight?</summary>
                <p>It may be outside the 40 nm circle, not yet in range of a volunteer receiver, or not broadcasting ADS-B (some military and older aircraft don&apos;t). Flive also shows planes by their radio callsign (like JBU470), which can differ from the flight number on your ticket.</p></details>
              <details><summary>Why does a landing plane sometimes show a negative altitude?</summary>
                <p>The altitude shown is barometric: it&apos;s worked out from air pressure assuming a &quot;standard&quot; day. When the real air pressure at Boston is high, planes near the runway can read slightly below zero. It&apos;s normal, and it&apos;s the same altitude pilots and controllers use.</p></details>
              <details><summary>Is this the same as what air traffic control sees?</summary>
                <p>No. Controllers use radar and certified systems with complete coverage. Flive uses volunteer receivers and is for curiosity and learning only. Never use it for navigation or safety decisions.</p></details>
              <details><summary>How accurate are the &quot;inbound&quot; and &quot;on approach&quot; labels?</summary>
                <p>Usually right for airliners near Logan, sometimes wrong for small planes heading to nearby airports. They&apos;re estimates from simple rules, and replacing them with real detection is the next roadmap step.</p></details>
              <details><summary>Why is Ask Flive sometimes offline or slow?</summary>
                <p>It runs a full language model on Flive&apos;s own machine instead of a paid cloud service. If the model isn&apos;t running, the chat says so and the map keeps working. Answers can take a few seconds, longer if several people ask at once.</p></details>
            </div>
          </Section>

          <Section id="glossary" kicker="Words" title="Glossary">
            <dl className="glossary">
              <dt>ADS-B</dt><dd>Automatic Dependent Surveillance–Broadcast: aircraft radio messages with identity, position and motion.</dd>
              <dt>Callsign</dt><dd>The name a flight uses on the radio, e.g. JBU470 = JetBlue flight 470.</dd>
              <dt>Registration</dt><dd>The aircraft&apos;s &quot;licence plate&quot;, e.g. N828JB. US registrations start with N.</dd>
              <dt>ICAO hex</dt><dd>A permanent 24-bit address built into the aircraft&apos;s transponder, shown as six characters like a1b2c3.</dd>
              <dt>Squawk</dt><dd>A four-digit code assigned by air traffic control so controllers can identify the plane.</dd>
              <dt>Groundspeed</dt><dd>Speed over the ground in knots (1 knot ≈ 1.15 mph). Wind makes it differ from airspeed.</dd>
              <dt>Track</dt><dd>The direction the plane is actually moving over the ground, in degrees (0° = north, 90° = east).</dd>
              <dt>Nautical mile (nm)</dt><dd>1.15 statute miles, or 1.852 km. Aviation&apos;s standard distance unit.</dd>
              <dt>MLAT</dt><dd>Multilateration: locating a plane from when its signal reaches several receivers.</dd>
              <dt>KBOS</dt><dd>The ICAO code for Boston Logan International Airport.</dd>
              <dt>LLM</dt><dd>Large language model: AI that generates text. Ask Flive uses one with tool calling.</dd>
              <dt>Tool calling</dt><dd>Letting an AI request specific data from a program instead of answering from memory.</dd>
            </dl>
          </Section>

          <footer className="about-foot">
            <p>
              Flive is a personal portfolio project. Aircraft data from <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer">adsb.fi</a>.
              Map <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a>
              {" "}© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors.
              Not for navigation.
            </p>
            <a className="btn-primary small" href="/">Back to the live map</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
