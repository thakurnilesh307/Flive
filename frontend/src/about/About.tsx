import { useEffect, useState, type ReactNode } from "react";
import TopNav, { REPO } from "./TopNav";

const SECTIONS = [
  ["what", "The map"],
  ["data", "Where the data comes from"],
  ["pipeline", "How it gets to your screen"],
  ["scaling", "Going worldwide"],
  ["smooth", "Why the planes glide"],
  ["status", "How the labels are guessed"],
  ["models", "The prediction models"],
  ["privacy", "Privacy and fair use"],
  ["stack", "What it's built with"],
  ["ask-flive", "Ask Flive (switched off)"],
  ["faq", "FAQ"],
  ["glossary", "Glossary"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="doc-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Collapsible technical detail, so the main text reads fine without it. */
function Dev({ children, title = "Technical details" }: { children: ReactNode; title?: string }) {
  return (
    <details className="dev">
      <summary>{title}</summary>
      <div className="dev-body">{children}</div>
    </details>
  );
}

const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

export default function About() {
  const [active, setActive] = useState<string>("what");

  // The browser tries to jump to #anchor before React has rendered the page; redo it once mounted.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
  }, []);

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
      <TopNav here="about" />

      <div className="intro">
        <h1>About Flive</h1>
        <p>
          Flive is a live map of the planes around Boston Logan, New York JFK and London Heathrow, and, if you zoom
          out, most of the rest of the world. I started it because I wanted to test a runway scheduling idea (what
          order should planes land in?) on real traffic instead of made-up planes. To do that I first needed the real
          traffic, so that&apos;s what this is.
        </p>
        <p>
          This page explains how it works. Each section is written for a normal reader; the &quot;Technical
          details&quot; boxes have the code-level stuff. What I&apos;ve found so far is on the <a href="/results.html">Results page</a>.
        </p>
      </div>

      <div className="doc-layout">
        <nav className="toc" aria-label="On this page">
          <p>On this page</p>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className={active === id ? "on" : ""}>{label}</a>
          ))}
        </nav>

        <main className="doc">
          <Section id="what" title="The map">
            <p>
              Every plane on the map is a real aircraft, pointed the way it&apos;s moving. The faded ones are on the
              ground. Click a plane, or its row in the list, to see its airline, type, altitude and speed, plus a trail
              of where it&apos;s been since you opened the page. The map then follows that plane until you drag it.
            </p>
            <p>The status next to each plane is my guess at what it&apos;s doing:</p>
            <ul className="legend">
              <li><span className="sw approach" />On approach: close to the airport, low, and coming down toward it.</li>
              <li><span className="sw inbound" />Inbound: further out, descending, heading for the airport.</li>
              <li><span className="sw departing" />Departing: climbing and heading away.</li>
              <li><span className="sw enroute" />En route: in the air nearby, but not clearly arriving or leaving.</li>
              <li><span className="sw ground" />On ground / taxiing.</li>
            </ul>
            <p>
              These come from position and movement, not flight plans, so they&apos;re sometimes wrong. The rules are
              further down under <a href="#status">how the labels are guessed</a>.
            </p>
            <p>
              The list at the bottom shows the planes in view, nearest to the middle of the map first. Over Logan, JFK
              or Heathrow you also get arrival and departure tabs, sorted by when my model thinks each plane will land.
              You can search for a callsign, an airline or an airport (&quot;JFK&quot;, &quot;Chicago&quot;) to jump
              there.
            </p>
            <p>
              Zoom out far enough and you get a globe with every plane I can get data for. Boston updates every 5
              seconds and JFK and Heathrow every 10. The rest of the world only updates about every 90 seconds, because
              free data has limits, so in between I move those planes forward myself.
            </p>
          </Section>

          <Section id="data" title="Where the data comes from">
            <p>
              Most planes carry a transponder that broadcasts <b>ADS-B</b> messages several times a second: the
              plane&apos;s ID, GPS position, altitude, speed and direction. It&apos;s been required in most US controlled
              airspace since 2020, so basically every airliner around Boston has one.
            </p>
            <p>
              Anyone with a cheap antenna can receive these, and thousands of volunteers share what they pick up.
              {" "}<a href="https://adsb.fi" {...ext}>adsb.fi</a> combines those feeds into one live picture, and that&apos;s
              what I use for the three airports. When a plane doesn&apos;t send its own position, receivers can sometimes
              work it out from the tiny differences in when its signal reaches each antenna (multilateration, or MLAT).
            </p>
            <p>
              For the rest of the world I use the <a href="https://opensky-network.org" {...ext}>OpenSky Network</a>,
              a research network that returns the whole planet in one request. You only get so many requests a day,
              which is why the world view refreshes every 90 seconds.
            </p>
            <p>
              OpenSky only gives positions, so I look each plane up by its transponder address in a public aircraft
              database (about 600,000 aircraft) to get its type and registration. The airline comes from the callsign:
              DLH415 starts with DLH, which is Lufthansa. Photos are from <a href="https://www.planespotters.net" {...ext}>Planespotters.net</a>,
              always credited to the photographer with a link back.
            </p>
            <p>
              What Flive can&apos;t know: where a flight came from or is going, gates, delays, or anything about
              passengers. That comes from airline schedules, not the radio signal.
            </p>
            <Dev>
              <p>
                <code>adsb_feed.py</code> polls <code>opendata.adsb.fi/api/v3/lat/…/lon/…/dist/40</code> every 5 s with a
                descriptive User-Agent. adsb.fi allows one request per second per IP and counts failures too, so on errors
                or a 429 the server backs off exponentially (10 s up to 300 s) and respects <code>Retry-After</code>.
              </p>
              <p>
                The response is readsb JSON, which I convert to my own snapshot format in SI units (metres, m/s). Feet, knots
                and fpm only exist in the UI. Callsigns, registrations and type codes are stripped to <code>[A-Z0-9-]</code> and
                length-capped on the server, since I treat everything from the provider as untrusted.
              </p>
              <pre>{`{"fetched_at": 1794650000.0, "api_time": 1794650000.0, "aircraft": [
  {"icao24": "a1b2c3", "callsign": "JBU317", "lat": 42.36, "lon": -71.01,
   "baro_alt_m": 1066.8, "on_ground": false, "velocity_ms": 92.6,
   "track_deg": 41.0, "vert_rate_ms": -3.8, "category": 4,
   "aircraft_type": "A320", "registration": "N123JB", ...}]}`}</pre>
              <p>
                I first planned to use adsb.lol, but keyless it allows 500 requests a day and polling every 5 s needs about
                17,000. adsb.fi uses the same format, so switching is just the <code>ADSB_URL</code> (and <code>ADSB_API_KEY</code>)
                environment variable.
              </p>
              <p>
                Aircraft details: <code>scripts/build_aircraft_db.py</code> loads <a href="https://github.com/wiedehopf/tar1090-db" {...ext}>tar1090-db</a>
                {" "}(Mictronics plus FAA records) into SQLite, so looking up ~6,000 planes per world refresh takes a few
                milliseconds. <code>aircraft_db.enrich()</code> adds type, registration, model name and operator before
                anything is broadcast. Operators come from the callsign prefix and the <a href="https://openflights.org/data" {...ext}>OpenFlights</a>
                {" "}airline list (5,775 ICAO codes). On a live check, 99% of worldwide planes got a type and 86% an operator.
              </p>
              <p>
                Photos come through <code>GET /api/aircraft/&#123;icao24&#125;</code>, which asks the Planespotters API (cached for
                a day, at most one request a second). Logos come through <code>GET /api/logo/&#123;ICAO&#125;</code>, from
                {" "}<a href="https://github.com/Jxck-S/airline-logos" {...ext}>Jxck-S/airline-logos</a>, cached on the server. The
                photo itself loads from Planespotters&apos; image host, which their terms require.
              </p>
            </Dev>
          </Section>

          <Section id="pipeline" title="How it gets to your screen">
            <pre className="sketch">{`plane --radio--> volunteer antennas --> adsb.fi
                                           |
                              Flive server asks every 5 s
                                           |
                     pushes the same update to every open page`}</pre>
            <p>
              Your browser never talks to adsb.fi. My server fetches the data once every 5 seconds and pushes it to
              everyone who has the page open, so a thousand viewers cost the volunteers the same as one.
            </p>
            <Dev>
              <ul>
                <li><code>server.py</code> (FastAPI) runs the pollers and keeps the latest snapshot in memory.</li>
                <li>Snapshots go out over a WebSocket at <code>/ws</code>; a new visitor gets the latest one straight away.</li>
                <li>Every third snapshot (every 15 s) is appended to a <code>*.jsonl</code> log. Those logs are what the models are scored against.</li>
                <li>The frontend is React and TypeScript, built with Vite.</li>
                <li>The site is split in two: the pages are static files on Vercel, and the server runs on a small always-on VM (Oracle Cloud&apos;s free tier) behind Caddy for HTTPS.</li>
              </ul>
            </Dev>
          </Section>

          <Section id="scaling" title="Going worldwide">
            <p>
              Flive started as a 40-mile circle around Boston with maybe 15 planes in it. Zoomed out, it now shows
              everything OpenSky can see, usually 5,000 to 6,000 planes even at night. Making that work on free data and
              one small server came down to a few choices.
            </p>
            <p>
              The three airports are fast and everything else is slow: adsb.fi every 5 or 10 seconds, OpenSky about every
              90. Only my server fetches anything, once, for everyone. Your page tells the server which part of the map
              you&apos;re looking at, and it only sends the planes in that area in a compact format; zoomed all the way out
              it sends an even sample of 2,000, always including the plane you clicked. And the planes are drawn by the
              graphics card instead of as thousands of page elements, which is what keeps panning smooth.
            </p>
            <p>
              The catch is coverage. The volunteer receivers cover Europe and North America well, but not the oceans or
              large parts of Africa, Asia and South America. So the real worldwide count is higher than what you see,
              and planes outside the three airports can be up to 90 seconds old before the map moves them forward.
            </p>
            <Dev title="Technical details: the numbers">
              <table className="rules">
                <thead><tr><th></th><th>Airports</th><th>World</th></tr></thead>
                <tbody>
                  <tr><td>Source</td><td>adsb.fi (readsb JSON, 1 req/s keyless)</td><td>OpenSky <code>/states/all</code> (4 credits/call, 4,000/day)</td></tr>
                  <tr><td>Refresh</td><td>5 s (Boston), 10 s (JFK, Heathrow)</td><td>90 s with an account, 900 s anonymous</td></tr>
                  <tr><td>Per fetch</td><td>~5 KB, ~15-70 aircraft</td><td>~675 KB, ~5,200 aircraft</td></tr>
                  <tr><td>Logged</td><td>every 15 s</td><td>never (it would be ~4 GB/day)</td></tr>
                  <tr><td>Glide</td><td>redrawn ~30×/s, capped at 20 s, corrections blended over 1.2 s</td><td>redrawn 4×/s, capped at 120 s, blended over 2.5 s</td></tr>
                </tbody>
              </table>
              <ul>
                <li>The world index is a 5° grid, built in ~16 ms for ~5,000 aircraft. A viewport query takes well under 1 ms and handles the antimeridian.</li>
                <li>The page sends <code>{"{"}"type":"view","bbox":[w,s,e,n],"keep":[icao24]{"}"}</code>. The server answers right away and after every world refresh with rows from a box padded by 25%, as arrays plus a field list (about 70 bytes per aircraft, 4.6× smaller than objects). Over 2,000 it thins round-robin across grid cells, airborne first.</li>
                <li>Planes are MapLibre symbol layers using one SDF plane image, recoloured per feature. The airports and the world are separate GeoJSON sources so they can tick at different rates.</li>
                <li>Everything world-related is in <code>world_feed.py</code>, so another data source could replace OpenSky without touching the map.</li>
              </ul>
            </Dev>
          </Section>

          <Section id="smooth" title="Why the planes glide">
            <p>
              New positions arrive every few seconds, so on their own the planes would jump. In between updates I move
              each plane forward in the direction and at the speed it&apos;s going, which pilots call <b>dead
              reckoning</b>. The guess is never exact, so when the next real position arrives the plane is slightly off,
              and instead of snapping it I slide it to the right spot over about a second.
            </p>
            <p>A plane that hasn&apos;t been heard from in 30 seconds fades out, and it&apos;s removed once it drops out of the feed.</p>
            <Dev>
              <p>
                <code>MapView.tsx</code> runs one <code>requestAnimationFrame</code> loop that redraws airport planes about 30
                times a second and world planes 4 times a second. Each plane is projected forward from its own timestamp
                (<code>time_position</code>), corrected for the clock difference between browser and server, with flat-earth
                maths, and never more than 20 s ahead. When a new report arrives, <code>makeSmoother</code> eases the gap
                between where the plane was drawn and its new estimate down to zero (1.2 s for the airports, 2.5 s for the
                world). Gaps over 0.3° count as real jumps and snap. Trails only live in your browser (about 10 minutes).
              </p>
            </Dev>
          </Section>

          <Section id="status" title="How the labels are guessed">
            <p>
              The radio signal doesn&apos;t say &quot;I&apos;m about to land&quot;, so the status label comes from three things:
              how far the plane is from the airport, whether it&apos;s pointed toward or away from it, and whether it&apos;s
              climbing or descending. Away from the three airports a plane just shows what it&apos;s doing: climbing,
              descending, cruising or on the ground.
            </p>
            <table className="rules">
              <thead><tr><th>Label</th><th>Rule</th></tr></thead>
              <tbody>
                <tr><td><span className="sw approach" />On approach</td><td>Within 15 nm, below 5,000 ft, pointed at the airport, and descending (or already below 2,000 ft)</td></tr>
                <tr><td><span className="sw inbound" />Inbound</td><td>Within 40 nm, below 18,000 ft, pointed at the airport, descending</td></tr>
                <tr><td><span className="sw departing" />Departing</td><td>Within 25 nm, climbing, and pointed away (or still very close). Also anything that just lifted off: under 1,500 ft, within 5 nm, not descending</td></tr>
                <tr><td><span className="sw enroute" />En route</td><td>Anything else in the air</td></tr>
              </tbody>
            </table>
            <p>
              Rules like these are easy to explain but easy to fool. A small plane heading for Hanscom or Norwood can look
              exactly like a Logan arrival. That&apos;s why the arrival lists and landing times don&apos;t use these rules
              anymore: they come from the trained models in the next section.
            </p>
            <Dev>
              <p>
                The rules are in <code>frontend/src/status.ts</code> and copied into <code>traffic.py</code> so the map and the
                server agree. &quot;Pointed at&quot; means the track is within 45° of the bearing to the airport, &quot;away&quot;
                means more than 120° off, and climbing or descending means a vertical rate past ±250 fpm.
              </p>
            </Dev>
          </Section>

          <Section id="models" title="The prediction models">
            <p>
              The point of all this was to compare real traffic with what a scheduler would do, and for that I needed to
              know exactly when and where every plane landed. So I built that up in steps. Each one is tested on days the
              model never saw, and the charts are on the <a href="/results.html">Results page</a>.
            </p>
            <ol className="steps">
              <li>
                Finding real landings and takeoffs. I follow each plane through the logged positions, catch the moment its
                &quot;on ground&quot; flag flips, and work out the runway from its heading and position. The flag glitches a lot,
                so there are sanity checks. Against OpenSky&apos;s official arrival records over 35 days, it finds 95-97% of
                arrivals at all three airports, and 99-100% of what it finds are real landings.
              </li>
              <li>
                When each plane will land. The obvious guess, distance divided by speed, is about 5 minutes off on average,
                because planes don&apos;t fly straight in: they follow the approach for whichever runway is in use. A model
                trained on 35 days of past traffic is about 1.2 minutes off at Logan, 0.9 at JFK and 1.3 at Heathrow, and
                under 3 minutes off even 20 minutes before landing. The first time I watched it live, five arrivals landed
                between 12 seconds and 2.6 minutes from what it said.
              </li>
              <li>
                Which runway. Logan often uses two runways at once, so it isn&apos;t obvious. A second model guesses the
                landing runway for arrivals and the takeoff runway for planes taxiing out: right 92-95% of the time for
                landings and 96-99% for takeoffs, against 87-98% for just picking the runway used most recently. My first
                version only tied that simple guess, until I stopped it from picking runways nobody was using.
              </li>
              <li>
                Is it landing here at all? When I scored the live predictions, the landing times were fine, but hundreds of
                planes a day got a prediction and then landed somewhere else: Newark, Gatwick, Bedford. The training data
                only had planes that did land, so the model never learned that. A separate model trained on every plane that
                came near fixed it. Since it went live, wrong arrival predictions dropped from 919 to 1 at JFK (377 to 3 at
                Logan, 526 to 4 at Heathrow) while it still catches 98-99% of real landings.
              </li>
              <li>
                Other airports. Everything started out hardcoded for Logan. Now any airport works, and elsewhere in the world
                a rougher &quot;global&quot; model guesses landing times from position alone. Tested on cities it never trained
                on, it&apos;s about 1.2 to 1.4 minutes off. The harder part is guessing which airport a plane is going to, so
                those predictions are marked as rough.
              </li>
            </ol>
            <p>
              What I&apos;m still working on: the &quot;likely&quot; time range shown with each prediction is too narrow live (it
              holds the real landing time only about 62% of the time at JFK, where I aimed for 80%), and a model that
              starts at a new airport with general knowledge and then switches to local data once it has a few days of it.
            </p>
            <Dev title="Technical details: the models and how they're tested">
              <ul>
                <li>History: <code>scripts/import_history.py</code> streams adsb.lol&apos;s daily archives (ODbL, ~3.5 GB/day worldwide) and keeps traces within 45 nm of each airport. <code>events.py</code> turns them and the live logs into landings and takeoffs with runways.</li>
                <li>Rows: each landing walked back 30 minutes, one row every 30 s, with distance and bearing, altitude, speed, vertical rate, heading against the runway in use, arrival traffic, time of day, and seconds to touchdown as the label. The runway it actually used is not a feature (you can&apos;t know it in advance); the runway in use over the previous 30 minutes is. The same <code>feature_row()</code> builds training and live inputs.</li>
                <li>Model: scikit-learn <code>HistGradientBoostingRegressor</code> with absolute-error loss, plus 10th/90th percentile models for the range, widened by a factor calibrated on held-out days.</li>
                <li>Testing: leave-one-day-out, because rows 30 s apart are near-duplicates and a random split would flatter the model. At Logan over 35 days: 1.17 min vs 5.40 for distance/speed; 0.36 / 1.13 / 2.57 min at 5 / 10 / 20 minutes out; 65% within a minute.</li>
                <li>Live: <code>eta.py</code> keeps 40 minutes of the feed, detects the runway in use, and predicts for aircraft the arrival model says are landing. Every prediction is logged, and <code>score_predictions.py</code> matches them to the landings found later in the same logs.</li>
                <li>Arrival model: <code>arrival_model.py</code>, a classifier trained on every plane that came within 40 nm, landed or not. Tested on unseen days: 98.9-99.4% of its arrival calls are right and it finds 91-97% of arrivals; the old hand-written rule managed 47-76% right.</li>
                <li>Global model: <code>global_model.py</code> trains on 11 airports and is tested leave-one-area-out (1.21-1.41 min vs 3.3-4.5 for distance/speed). For &quot;which airport&quot;, a simple rule beat a trained classifier on unseen areas, so the rule is what runs.</li>
              </ul>
            </Dev>
          </Section>

          <Section id="privacy" title="Privacy and fair use">
            <p>
              No accounts, cookies, ads or analytics. The only thing stored in your browser is whether you picked the
              light or dark theme.
            </p>
            <p>
              Everything about the planes is broadcast openly and is already on plenty of flight-tracking sites. Flive
              shows the callsign, plus registration and type from a public aircraft database. It never shows owners (the
              database has owner names, and for private planes that&apos;s often a person) or anything about passengers.
              Planes enrolled in the FAA&apos;s privacy programs only show their type, with no registration or photo.
            </p>
            <p>
              adsb.fi is run by volunteers, so the server asks once every 5 seconds for everyone combined, backs off when
              told to, and credits them on every page.
            </p>
          </Section>

          <Section id="stack" title="What it's built with">
            <table className="rules">
              <tbody>
                <tr><td>Data</td><td>adsb.fi open data (the three airports) and the OpenSky Network (the world, and arrival records for checking)</td></tr>
                <tr><td>Aircraft details</td><td>tar1090-db / Mictronics (types and registrations), OpenFlights (airline names, ODbL), Planespotters.net (photos), Jxck-S/airline-logos (logos; trademarks belong to the airlines)</td></tr>
                <tr><td>Server</td><td>Python 3.11, FastAPI, WebSockets, scikit-learn</td></tr>
                <tr><td>Frontend</td><td>React, TypeScript, Vite, MapLibre GL, IBM Plex</td></tr>
                <tr><td>Map</td><td>OpenFreeMap vector tiles, © OpenMapTiles, © OpenStreetMap contributors</td></tr>
                <tr><td>Hosting</td><td>Vercel (pages), Oracle Cloud free tier (server), Docker, Caddy</td></tr>
                <tr><td>Code</td><td><a href={REPO} {...ext}>github.com/thakurnilesh307/Flive</a></td></tr>
              </tbody>
            </table>
            <Dev title="Run it yourself">
              <pre>{`python -m pip install -r requirements.txt
cd frontend; npm install; npm run build; cd ..
python -m uvicorn server:app      # http://127.0.0.1:8000`}</pre>
              <p>The prediction models need the history imported and trained first; the README has the steps.</p>
            </Dev>
          </Section>

          <Section id="ask-flive" title="Ask Flive (switched off)">
            <p>
              Early on I added a chat where you could ask things like &quot;What&apos;s landing next?&quot;. It ran a small
              language model on my own machine and used <b>tool calling</b>: instead of answering from memory (and making
              planes up), the model asked my server for specific live data and wrote its answer from that. It worked
              most of the time, but a small model still got things wrong now and then, and the map already shows the
              same information, so it&apos;s off on the public site. The code is still in the repo and turns on with
              {" "}<code>ASK_FLIVE=on</code>.
            </p>
            <Dev title="Technical details: tools and guardrails">
              <p>The model (<code>qwen3:8b</code> through Ollama by default) gets seven tools from <code>ask.py</code>:</p>
              <table className="rules">
                <thead><tr><th>Tool</th><th>Returns</th></tr></thead>
                <tbody>
                  <tr><td><code>traffic_summary</code></td><td>Counts: total, airborne, on ground, by status</td></tr>
                  <tr><td><code>list_aircraft</code></td><td>Aircraft sorted by distance, with altitude, speed and direction</td></tr>
                  <tr><td><code>get_aircraft</code></td><td>One aircraft by callsign, registration or hex, or <code>found: false</code></td></tr>
                  <tr><td><code>landing_sequence</code></td><td>Planes arriving at Logan in order</td></tr>
                  <tr><td><code>aircraft_near</code></td><td>Aircraft around any airport or city</td></tr>
                  <tr><td><code>find_airport</code></td><td>An airport by code, name or city (OurAirports, 3,265 airports)</td></tr>
                  <tr><td><code>world_summary</code></td><td>Worldwide counts, data age, and a coverage warning</td></tr>
                </tbody>
              </table>
              <p>
                At most 4 tool rounds per question. The server runs <code>get_aircraft</code> itself for any callsign in the
                question, and sends the model back once if it answers without checking the data, because an 8B model
                sometimes skipped that. Tools return pre-worded values (&quot;at least 4 minutes away, not an ETA&quot;)
                so it can&apos;t turn rough numbers into confident claims. Answers are plain text, questions are capped at
                300 characters and rate-limited per visitor, and the only provider text the model sees is callsign,
                registration and type, already stripped to <code>[A-Z0-9-]</code>.
              </p>
            </Dev>
          </Section>

          <Section id="faq" title="FAQ">
            <div className="faq">
              <details><summary>Why can&apos;t I find a specific flight?</summary>
                <p>It might be out of range of a volunteer receiver, or not broadcasting ADS-B at all (some military and older planes don&apos;t). Flive also shows the radio callsign (like JBU470), which isn&apos;t always the flight number on your ticket.</p></details>
              <details><summary>Why did landing planes use to show a negative altitude?</summary>
                <p>Planes broadcast barometric altitude, worked out from air pressure assuming a &quot;standard&quot; day. On a high-pressure morning that reads too low, so a plane on the runway could show -400 ft. Pilots correct for it by dialling in the local pressure, and Flive now does the same: every 10 minutes the server fetches the latest weather reports (METARs) from about 4,800 airports and corrects low planes with the nearest one.</p></details>
              <details><summary>Is this what air traffic control sees?</summary>
                <p>No. Controllers use radar and certified systems. Flive runs on volunteer receivers and is for curiosity and learning only. Don&apos;t use it for navigation or anything safety-related.</p></details>
              <details><summary>How accurate are the status labels?</summary>
                <p>Usually right for airliners near the three airports, sometimes wrong for small planes going to nearby airfields. The arrival lists and predicted landing times use the trained models instead, which are much more reliable (see <a href="#models">the prediction models</a>).</p></details>
            </div>
          </Section>

          <Section id="glossary" title="Glossary">
            <dl className="glossary">
              <dt>ADS-B</dt><dd>Automatic Dependent Surveillance-Broadcast: the radio messages planes send with their ID, position and movement.</dd>
              <dt>Callsign</dt><dd>The name a flight uses on the radio, e.g. JBU470 is JetBlue flight 470.</dd>
              <dt>Registration</dt><dd>The plane&apos;s licence plate, e.g. N828JB. US registrations start with N.</dd>
              <dt>ICAO hex</dt><dd>A permanent 24-bit address built into the transponder, written as six characters like a1b2c3.</dd>
              <dt>Squawk</dt><dd>A four-digit code air traffic control assigns a plane so they can identify it.</dd>
              <dt>Groundspeed</dt><dd>Speed over the ground in knots (1 knot is about 1.15 mph). Wind makes it differ from airspeed.</dd>
              <dt>Track</dt><dd>The direction the plane is moving over the ground, in degrees (0° is north, 90° east).</dd>
              <dt>Nautical mile (nm)</dt><dd>1.15 regular miles, or 1.852 km.</dd>
              <dt>MLAT</dt><dd>Multilateration: locating a plane from when its signal reaches several receivers.</dd>
              <dt>KBOS, KJFK, EGLL</dt><dd>The ICAO codes for Boston Logan, New York JFK and London Heathrow.</dd>
            </dl>
          </Section>

          <footer className="about-foot">
            <p>
              Flive is a personal project and not for navigation. Aircraft data from <a href="https://adsb.fi" {...ext}>adsb.fi</a> and
              the <a href="https://opensky-network.org" {...ext}>OpenSky Network</a>, photos from <a href="https://www.planespotters.net" {...ext}>Planespotters.net</a>,
              airline names from <a href="https://openflights.org/data" {...ext}>OpenFlights</a>. Map <a href="https://openfreemap.org" {...ext}>OpenFreeMap</a>
              {" "}© <a href="https://www.openmaptiles.org/" {...ext}>OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" {...ext}>OpenStreetMap</a> contributors.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
