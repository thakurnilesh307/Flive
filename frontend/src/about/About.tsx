import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "../components/icons";

const REPO = "https://github.com/thakurnilesh307/Flive";

const SECTIONS = [
  ["what", "The map"],
  ["data", "Where the data comes from"],
  ["pipeline", "How it gets to your screen"],
  ["scaling", "Going worldwide"],
  ["smooth", "Why the planes glide"],
  ["status", "How the labels are guessed"],
  ["ask-flive", "Ask Flive"],
  ["roadmap", "What I'm working on next"],
  ["privacy", "Privacy and fair use"],
  ["stack", "What it's built with"],
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
      <header className="about-top">
        <a className="about-brand" href="/"><Logo size={30} /><span>Flive</span></a>
        <nav className="about-top-links">
          <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a className="btn-primary small" href="/">Back to the map</a>
        </nav>
      </header>

      <div className="intro">
        <h1>About Flive</h1>
        <p>
          Flive is a live map of the planes around Boston Logan (and, if you zoom out, the rest of the world). I built
          it on top of an older project of mine, a runway scheduling simulator in Python with a little Pygame radar
          screen. The simulator only ever had made-up planes, and I wanted to see how it would do against real ones.
          That meant I needed real, live traffic first, and this is that part.
        </p>
        <p>
          This page is my write-up of how it works. Each section starts with the normal explanation. If you want the
          code-level stuff, open the &quot;Technical details&quot; boxes.
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
              Every plane icon is a real aircraft, pointed the way it&apos;s moving. The smaller grey ones are on the
              ground at Logan. Click a plane (or a row in the list at the bottom) and you get its airline, aircraft type,
              altitude, speed, and a dashed trail of where it&apos;s been since you opened the page. The map also zooms in and follows
              the plane, so it stays in the middle while the map moves under it. Drag the map to stop following, or hit the
              arrow button in the panel to start again.
            </p>
            <p>The colours are my guess at what each plane is doing:</p>
            <ul className="legend">
              <li><span className="dot green" /> <b>On approach</b>: close to Logan, low, and coming down toward it.</li>
              <li><span className="dot blue" /> <b>Inbound</b>: further out, descending, and heading for Logan.</li>
              <li><span className="dot amber" /> <b>Departing</b>: climbing and heading away.</li>
              <li><span className="dot violet" /> <b>En route</b>: in the air nearby but not clearly arriving or leaving.</li>
              <li><span className="dot grey" /> <b>On ground / taxiing</b>: on the airport.</li>
            </ul>
            <p>
              They really are guesses, based on position and movement, not flight plans. I explain the rules further down
              in <a href="#status">how the labels are guessed</a>.
            </p>
            <p>
              The list at the bottom follows the map: it shows the planes you&apos;re looking at, nearest to the middle first,
              with where they are (&quot;12 nm NE of JFK&quot;). Over Boston you also get Logan arrival and departure tabs. You can
              search for an airport (&quot;JFK&quot;, &quot;Heathrow&quot;, &quot;Chicago&quot;) to jump straight there.
            </p>
            <p>
              If you zoom out far enough the map turns into a globe with every plane I can get data for. Boston updates
              every 5 seconds. The rest of the world only updates about every 90 seconds (free data has limits), so in
              between the planes are moved forward on their own so nothing looks frozen.
            </p>
          </Section>

          <Section id="data" title="Where the data comes from">
            <p>
              Most planes have a transponder that sends out <b>ADS-B</b> messages several times a second. Each message
              has the plane&apos;s ID, GPS position, altitude, speed and direction. Since 2020 it&apos;s been required in most
              US controlled airspace, so basically every airliner around Boston has it.
            </p>
            <p>
              The cool part is that anyone with a cheap antenna can pick these up, and thousands of volunteers do and share
              what they receive. I use <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer">adsb.fi</a>,
              which combines all those volunteer feeds into one live picture. If a plane isn&apos;t sending its own position,
              receivers can sometimes work it out from tiny differences in when the signal reaches each antenna (that&apos;s
              called multilateration, or MLAT).
            </p>
            <p>
              For the rest of the world I use the <a href="https://opensky-network.org" target="_blank" rel="noopener noreferrer">OpenSky Network</a>,
              a research network that can give you the whole planet in one request. You only get a certain number of requests
              per day though, which is why the world view refreshes every 90 seconds and not every 5.
            </p>
            <p>
              The OpenSky feed only has positions, so on its own every plane outside Boston would say &quot;unknown type,
              unknown operator&quot;. To fill that in I look each plane up by its transponder address in a public aircraft
              database (about 600,000 aircraft), which gives the type and registration. The airline comes from the callsign:
              DLH415 starts with DLH, which is Lufthansa. Photos come from <a href="https://www.planespotters.net" target="_blank" rel="noopener noreferrer">Planespotters.net</a>,
              always with the photographer&apos;s name and a link to the original.
            </p>
            <p>
              Things Flive doesn&apos;t know: where a flight came from or where it&apos;s going, gates, delays, or anything about
              passengers. That comes from airline schedules, not the radio signal.
            </p>
            <Dev>
              <p>
                <code>adsb_feed.py</code> polls <code>opendata.adsb.fi/api/v3/lat/…/lon/…/dist/40</code> every 5 s with a
                descriptive User-Agent. adsb.fi allows 1 request per second per IP and counts failed requests too, so on
                errors or a 429 the server backs off exponentially (10 s up to 300 s, and it respects <code>Retry-After</code>).
              </p>
              <p>
                The response is readsb JSON. I convert it to my own snapshot format and keep everything in SI units
                (metres, m/s). Feet, knots and fpm only exist in the UI. Callsigns, registrations and type codes get stripped
                to <code>[A-Z0-9-]</code> and length-capped on the server, because I treat everything from the provider as
                untrusted.
              </p>
              <pre>{`{"fetched_at": 1794650000.0, "api_time": 1794650000.0, "aircraft": [
  {"icao24": "a1b2c3", "callsign": "JBU317", "lat": 42.36, "lon": -71.01,
   "baro_alt_m": 1066.8, "on_ground": false, "velocity_ms": 92.6,
   "track_deg": 41.0, "vert_rate_ms": -3.8, "category": 4,
   "aircraft_type": "A320", "registration": "N123JB", ...}]}`}</pre>
              <p>
                I originally planned to use adsb.lol, but without a key it&apos;s 500 requests a day, and polling every 5 s
                needs about 17,000. adsb.fi uses the same format, so switching back is just an environment variable
                (<code>ADSB_URL</code>, plus <code>ADSB_API_KEY</code> if needed).
              </p>
              <p>
                <b>Aircraft details.</b> <code>scripts/build_aircraft_db.py</code> loads
                {" "}<a href="https://github.com/wiedehopf/tar1090-db" target="_blank" rel="noopener noreferrer">tar1090-db</a>
                {" "}(Mictronics database plus FAA records) into SQLite, so looking up ~6,000 planes per world refresh takes a
                few milliseconds and almost no memory. <code>aircraft_db.enrich()</code> adds type, registration, a full model
                name and the operator to both feeds before they&apos;re broadcast. Operators come from the callsign prefix using
                the <a href="https://openflights.org/data" target="_blank" rel="noopener noreferrer">OpenFlights</a> airline list
                (5,775 ICAO codes). On a live check 99% of worldwide planes got a type and 86% an operator.
              </p>
              <p>
                Photos: <code>GET /api/aircraft/&#123;icao24&#125;</code> asks the Planespotters API (cached for a day, at most one
                request a second). Logos: <code>GET /api/logo/&#123;ICAO&#125;</code> serves square logos from
                {" "}<a href="https://github.com/Jxck-S/airline-logos" target="_blank" rel="noopener noreferrer">Jxck-S/airline-logos</a>,
                {" "}downloaded once and cached on the server. Your browser only talks to my server for both, except that the
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
              Your browser never talks to adsb.fi itself. My server grabs the data once every 5 seconds and pushes it to
              everyone who has the page open. I did it this way so I&apos;m not hammering a volunteer-run service: a thousand
              people looking at the map costs adsb.fi the same as one.
            </p>
            <Dev>
              <ul>
                <li><code>server.py</code> (FastAPI) runs one background poller and keeps the latest snapshot in memory.</li>
                <li>Snapshots go out over a WebSocket at <code>/ws</code>. Someone who just opened the page gets the latest one straight away.</li>
                <li>Every third snapshot (so every 15 s) is appended to a <code>logan_*.jsonl</code> log. Those logs are the data for the prediction work further down.</li>
                <li>The frontend is React + TypeScript (Vite), served as static files by the same server.</li>
                <li>There&apos;s a second, slower poller for the rest of the world. More on that in <a href="#scaling">going worldwide</a>.</li>
              </ul>
            </Dev>
          </Section>

          <Section id="scaling" title="Going worldwide">
            <p>
              At first Flive was just a circle around Boston with maybe 15 planes in it. Now if you zoom out you see every
              plane OpenSky can see, which is usually 5,000 to 6,000 even late at night, and more during the day. Getting
              that to work on free data and one small server came down to a few decisions:
            </p>
            <ol className="steps">
              <li>
                <b>Boston fast, everything else slow.</b> Boston comes from adsb.fi every 5 seconds. The world comes from
                OpenSky about every 90 seconds, because whole-planet requests are limited per day. Anything to do with
                landings at Logan only uses the fast feed.
              </li>
              <li>
                <b>One fetch, shared by everyone.</b> Only my server asks for data, same idea as above.
              </li>
              <li>
                <b>You only get what&apos;s on your screen.</b> The page tells the server which part of the map you&apos;re
                looking at, and the server only sends those planes, in a compact format. When you&apos;re zoomed all the way out
                it sends an even sample of 2,000 from all over, and always includes the plane you&apos;ve clicked on.
              </li>
              <li>
                <b>The GPU draws the planes.</b> Thousands of planes as separate page elements would crawl, so they&apos;re drawn
                straight on the graphics card instead. That&apos;s what keeps panning around smooth.
              </li>
              <li>
                <b>Ask Flive knows about other airports.</b> It can answer about any airport or city using a free database of
                3,265 airports, and it tells you when the worldwide numbers are incomplete.
              </li>
            </ol>
            <p>
              The limits: the volunteer receivers behind OpenSky cover Europe and North America well, but oceans and big
              parts of Africa, Asia and South America not so much. So the real worldwide number is higher than what you
              see, and planes outside Boston can be up to a minute and a half old before the map moves them forward.
            </p>
            <Dev title="Technical details: the numbers">
              <table className="rules">
                <thead><tr><th></th><th>Boston</th><th>World</th></tr></thead>
                <tbody>
                  <tr><td>Source</td><td>adsb.fi (readsb JSON, 1 req/s keyless)</td><td>OpenSky <code>/states/all</code> (4 credits/call, 4,000/day)</td></tr>
                  <tr><td>Refresh</td><td>5 s</td><td>90 s with an account, 900 s anonymous</td></tr>
                  <tr><td>Per fetch</td><td>~5 KB, ~15 aircraft</td><td>~675 KB, ~5,200 aircraft</td></tr>
                  <tr><td>Logged</td><td>every 15 s (~30 MB/day)</td><td>never (would be ~4 GB/day at 15 s)</td></tr>
                  <tr><td>Glide</td><td>redrawn ~30×/s, capped at 20 s, corrections blended over 1.2 s</td><td>redrawn 4×/s, capped at 120 s, corrections blended over 2.5 s</td></tr>
                </tbody>
              </table>
              <ul>
                <li><b>Index:</b> a 5° grid, built in ~16 ms for ~5,000 aircraft. Viewport queries take well under 1 ms and handle the antimeridian.</li>
                <li><b>Protocol:</b> the page sends <code>{"{"}"type":"view","bbox":[w,s,e,n],"keep":[icao24]{"}"}</code>. The server answers right away and after every world refresh with rows from a box padded by 25%, sent as arrays plus a field list (4.6× smaller than objects, ~70 bytes per aircraft). It caps at 2,000 with round-robin thinning across grid cells, airborne first. The whole world is about 140 KB this way vs about 630 KB as objects; a region is about 10 KB.</li>
                <li><b>Rendering:</b> MapLibre symbol layers using one SDF plane image that gets recoloured by feature properties. Boston and world are separate GeoJSON sources so they can tick at different rates.</li>
                <li><b>Swapping the source:</b> all of it lives in <code>world_feed.py</code>, so a receiver-fed account (8,000 credits, ~45 s) or a paid API could replace it without touching the protocol or the map.</li>
              </ul>
            </Dev>
          </Section>

          <Section id="smooth" title="Why the planes glide">
            <p>
              New positions come in every 5 seconds, so without doing anything the planes would jump around. In between
              updates I move each plane forward in the direction it&apos;s going at the speed it&apos;s going. Pilots and sailors
              call this <b>dead reckoning</b>. My guess is never perfect though, so when the next real position shows up the
              plane is a little off. Instead of snapping it there, I slide it over to the right spot over about a second.
            </p>
            <p>
              If a plane hasn&apos;t been heard from in 30 seconds, it fades out. Once it drops out of the feed, it&apos;s removed.
            </p>
            <Dev>
              <p>
                <code>MapView.tsx</code> runs one <code>requestAnimationFrame</code> loop that redraws Boston planes about 30 times a second and world planes 4 times a second (there can be 2,000 of those). For each plane in the air it works out how long it&apos;s been since
                that position&apos;s own timestamp (<code>time_position</code>), corrected for clock differences between the
                browser and server, and projects it forward with flat-earth maths (fine over a few seconds). It never projects
                more than 20 s, so a stale plane can&apos;t wander off. When a new report arrives, <code>makeSmoother</code> stores the gap between where the plane was drawn and its new estimate and eases that gap to zero (1.2 s for Boston, 2.5 s for the world). Gaps over 0.3° are treated as real jumps and snap. Trails only live in the browser (about the last 10 minutes
                per plane).
              </p>
            </Dev>
          </Section>

          <Section id="status" title="How the labels are guessed">
            <p>
              The signal doesn&apos;t say &quot;I&apos;m about to land&quot;, so I look at three things: how far the plane is from
              Logan, whether it&apos;s pointed toward or away from it, and whether it&apos;s climbing or descending. A few simple
              rules turn that into a label. These Logan labels only exist around Boston, because that&apos;s where I have
              5-second data. Everywhere else a plane just says what it&apos;s doing: Climbing, Descending, Cruising or on the
              ground.
            </p>
            <table className="rules">
              <thead><tr><th>Label</th><th>Rule</th></tr></thead>
              <tbody>
                <tr><td><span className="dot green" /> On approach</td><td>Within 15 nm, below 5,000 ft, pointed at Logan, and descending (or already below 2,000 ft)</td></tr>
                <tr><td><span className="dot blue" /> Inbound</td><td>Within 40 nm, below 18,000 ft, pointed at Logan, descending</td></tr>
                <tr><td><span className="dot amber" /> Departing</td><td>Within 25 nm, climbing, and pointed away from Logan (or still really close to it). Also anything that just lifted off: under 1,500 ft, within 5 nm, and not descending</td></tr>
                <tr><td><span className="dot violet" /> En route</td><td>Anything in the air that doesn&apos;t match the above</td></tr>
              </tbody>
            </table>
            <p>
              Rules like this are easy to explain, but they get fooled. A small plane going to Hanscom or Norwood can look
              like it&apos;s inbound to Logan. Replacing these with actual landing and take-off detection is my next big step
              (see <a href="#roadmap">what I&apos;m working on next</a>).
            </p>
            <Dev>
              <p>
                The rules are in <code>frontend/src/status.ts</code> (for the map) and copied into <code>traffic.py</code> (for
                the AI) so the two always agree. &quot;Pointed at Logan&quot; means the track is within 45° of the bearing to
                KBOS, &quot;away&quot; means more than 120° off, and climbing or descending means a vertical rate past ±250 fpm.
              </p>
            </Dev>
          </Section>

          <Section id="ask-flive" title="Ask Flive">
            <p>
              Ask Flive is a chat where you can ask stuff like &quot;What&apos;s landing next?&quot;, &quot;How busy is Heathrow?&quot;
              or &quot;Where is DLH400 right now?&quot;. It runs on a <b>large language model</b> (LLM), which is software trained
              on a huge amount of text to predict what comes next. The problem with LLMs is that they&apos;ll confidently make
              things up. Ask one about planes over Boston and it&apos;ll just invent some.
            </p>
            <p>
              So I don&apos;t let it answer from memory. It uses <b>tool calling</b> instead, which goes like this:
            </p>
            <ol>
              <li>You ask a question.</li>
              <li>The model asks my server for a specific thing, like &quot;give me the landing order&quot;.</li>
              <li>The server looks that up in the live data and sends back the result.</li>
              <li>The model writes its answer using only that result.</li>
            </ol>
            <p>
              If the data doesn&apos;t have the answer (like where a flight is headed), it&apos;s told to say it doesn&apos;t know.
              Under each answer you can see which lookups it did, like &quot;Checked landing order&quot;. It&apos;s still an AI
              and can word things wrong sometimes, so trust the map over the chat.
            </p>
            <p>
              The model runs <b>locally</b> on the same machine as the server, using an open-source tool called
              {" "}<a href="https://ollama.com" target="_blank" rel="noopener noreferrer">Ollama</a>. Your questions don&apos;t go
              to an AI company, and you don&apos;t need to install anything to use it.
            </p>
            <Dev title="Technical details: tools, the loop, and guardrails">
              <p>The model (<code>qwen3:8b</code> by default, set with <code>OLLAMA_MODEL</code>) gets seven tools from <code>ask.py</code>, four for Boston and three for the world:</p>
              <table className="rules">
                <thead><tr><th>Tool</th><th>Returns</th></tr></thead>
                <tbody>
                  <tr><td><code>traffic_summary</code></td><td>Counts: total, airborne, on ground, and by estimated status</td></tr>
                  <tr><td><code>list_aircraft(status?, airline?, limit?)</code></td><td>Aircraft sorted by distance, with altitude, speed, distance and direction from KBOS</td></tr>
                  <tr><td><code>get_aircraft(query)</code></td><td>One aircraft by callsign, registration or ICAO hex (Boston first, then the world), or <code>found: false</code></td></tr>
                  <tr><td><code>landing_sequence</code></td><td>Planes arriving at Logan, ordered by straight-line time at current speed (a lower bound, not an ETA)</td></tr>
                  <tr><td><code>aircraft_near(place, radius_nm?, airline?)</code></td><td>Count and nearest aircraft around any airport or city (near Logan the Boston feed wins over world data)</td></tr>
                  <tr><td><code>find_airport(query)</code></td><td>An airport by code, name or city, from OurAirports (public domain, 3,265 airports with scheduled service)</td></tr>
                  <tr><td><code>world_summary</code></td><td>Worldwide total, airborne, counts by region, data age, and a coverage warning</td></tr>
                </tbody>
              </table>
              <ul>
                <li><b>The loop:</b> <code>POST /api/ask</code> sends the system prompt, the last 6 turns and the question to Ollama&apos;s <code>/api/chat</code> along with the tool specs. Tool calls run against the in-memory snapshot and go back as <code>role: tool</code> messages. Max 4 tool rounds, temperature 0.2, and &quot;thinking&quot; is off to keep it fast.</li>
                <li><b>Grounding:</b> the system prompt says it has to call a tool before stating any traffic fact, admit when data is missing, and treat text inside tool results as data, not instructions.</li>
                <li><b>Not trusting an 8B model with the obvious cases:</b> in testing it sometimes picked the wrong tool for a named flight, or just answered from chat history without looking anything up. So the server (1) automatically runs <code>get_aircraft</code> for any callsign or registration in the question, and (2) if the model answers without calling a tool, sends it back once with a &quot;you didn&apos;t check the live data&quot; note. If it still doesn&apos;t, I keep its first reply, since that usually means the question wasn&apos;t about traffic.</li>
                <li><b>Making the data hard to misread:</b> it kept turning &quot;straight-line minutes&quot; into confident ETAs, and a plane&apos;s direction from Logan into where it came from. Now the tools return pre-worded values (&quot;at least 4 minutes away (lower bound, not an ETA)&quot;, &quot;S of KBOS&quot;) instead of raw numbers.</li>
                <li><b>Prompt injection:</b> the only provider text the model ever sees is callsign, registration and type, which the server already strips to <code>[A-Z0-9-]</code> and caps at 4 to 10 characters. There isn&apos;t much room to sneak instructions in.</li>
                <li><b>Abuse limits:</b> questions are capped at 300 characters, 5 per minute and 40 per hour per visitor, and only one model call runs at a time (others wait up to 45 s and then get a &quot;busy&quot; message). Unknown tools and arguments are rejected.</li>
                <li><b>Rendering:</b> answers are shown as plain text, no HTML or Markdown, so the model can&apos;t inject markup.</li>
                <li><b>Swappable backend:</b> the model sits behind a small <code>chat(messages, tools)</code> function, so when I deploy I can use a different host without touching the tools.</li>
              </ul>
            </Dev>
          </Section>

          <Section id="roadmap" title="What I'm working on next">
            <p>
              Like I said at the top, Flive came out of my runway scheduling simulator, which plans the order planes land in
              kind of like air traffic control does. The real goal is to point that kind of model at actual Logan traffic and
              see how close it gets. The plan:
            </p>
            <ol className="steps">
              <li>
                <b>Detect real arrivals and departures (done).</b> I follow each plane through the logged snapshots, catch the
                moment it touches down or takes off (its &quot;on ground&quot; flag flips), and figure out which runway it used from
                its heading and position. The flag glitches a lot, so there are sanity checks, and small planes that never
                send it get an inferred landing when they disappear low on final. Checked against OpenSky&apos;s official
                arrival records over 18 days, it found 96-97% of arrivals at Logan, JFK and Heathrow, and every landing it found was real.
              </li>
              <li>
                <b>Predict when each plane lands (done, and live).</b> The simple guess is distance divided by speed, but planes
                don&apos;t fly straight in: they fly the approach pattern for whichever runway is in use, so that guess was almost
                5 minutes off on average. I trained a model on 20 days of past Logan traffic (downloaded from adsb.lol&apos;s open
                archives) and tested it on days it had never seen: it&apos;s about 1.2 minutes off on average, and under 3 minutes
                off even 20 minutes before landing. (On one week it scored 1.0; more test days include harder ones, so this is
                the honest number.) You can see it on the map: click an arriving
                plane, or open the Logan arrivals tab. The first time I watched it live, five arrivals landed between 12 seconds
                and 2.6 minutes from what it predicted.
              </li>
              <li>
                <b>Predict which runway each flight uses (done, and live).</b> Logan often lands or takes off on two runways at
                once, so which one a plane gets isn&apos;t obvious. A second model guesses the landing runway for arrivals and the
                takeoff runway for planes still taxiing, with how sure it is. On days it never saw, it got the landing runway right
                96% of the time and the takeoff runway 95% of the time, versus about 92% for just guessing &quot;whichever runway
                Logan has been using most&quot;. My first version only tied that simple guess, until I stopped it from picking
                runways nobody was using.
              </li>
              <li>
                <b>More airports (done, and live).</b> Everything started out hardcoded for Logan. Now the same code works for any
                airport, and JFK and London Heathrow get the full treatment: their own landing-time and runway models and a fast
                live feed. On days the models never saw, JFK landings were predicted about 1.0 minute off and Heathrow about 1.2.
                Everywhere else gets a rougher estimate from one &quot;global&quot; model. It only knows what a single position says,
                and I tested it on whole cities it never trained on: it was about 1.2 to 1.4 minutes off, close to the dedicated models.
                The hard part turned out to be guessing <i>which</i> airport a plane is going to, so those predictions are labelled
                as rough. The first live run also caught a plane landing at Gatwick being counted as a Heathrow arrival. Fixed now.
              </li>
              <li>
                <b>Check it against what really happened (started).</b> Flive logs every prediction it shows, so I can compare
                each one with the landing that followed. For planes that really landed, the live predictions were 0.8 minutes off
                at Logan and JFK and about 1 minute at Heathrow, as good as the tests. The weak part is somewhere else:
                many planes got a prediction and never landed, because they were going to a nearby airport like Newark,
                Gatwick or Bedford, or just passing through. The training data never showed this, because it only had planes
                that did land. Telling arrivals apart early is the next thing to fix.
              </li>
            </ol>
            <Dev title="Technical details: the model and how it's tested">
              <ul>
                <li><b>Data:</b> <code>scripts/import_history.py</code> streams adsb.lol&apos;s daily archives (ODbL, ~3.5 GB/day worldwide) and keeps only traces within 45 nm of Logan; <code>events.py</code> turns them (and the live logs) into landings with runway; checked against OpenSky&apos;s arrival records (Nov 1-18) at 96-97% recall and 100% precision at all three airports.</li>
                <li><b>Rows:</b> each landing walked back 30 minutes, one row every 30 s: distance and bearing from Logan, altitude, speed, vertical rate, heading vs the runway in use, arrival-flow traffic, time of day, and the label (seconds to touchdown). The runway it actually landed on is NOT a feature (you don&apos;t know it in advance); the runway in use over the previous 30 minutes is. The same <code>feature_row()</code> builds inputs for training and live serving.</li>
                <li><b>Model:</b> scikit-learn <code>HistGradientBoostingRegressor</code> with absolute-error loss, plus 10th/90th percentile models for the &quot;likely&quot; range, widened by a factor calibrated on held-out days so it holds about 80% of real landings.</li>
                <li><b>Test:</b> leave-one-day-out (rows 30 s apart are near-duplicates, so a random split would flatter it). Held-out error over 20 days: 1.19 min vs 5.51 for distance/speed; 0.34 / 1.15 / 2.70 min at 5 / 10 / 20 minutes out; 65% within a minute (one week gave 1.01, on an easier test set). Biggest inputs: altitude, then position relative to the runway in use.</li>
                <li><b>Live:</b> <code>eta.py</code> keeps 40 minutes of the 5 s feed, detects the runway in use, and predicts only for aircraft that look like Logan arrivals (not climbing, not just off the ground, not helicopters: the model only ever saw planes that landed). Predictions are logged so they can be scored against real landings.</li>
                <li><b>Any airport:</b> <code>airport_geo.py</code> holds each airport&apos;s runways (OurAirports), elevation and time zone; every script takes an ICAO code. JFK and Heathrow have their own adsb.fi feed every 10 s, with all requests at least 1.2 s apart. <code>global_model.py</code> trains one model on 11 airports (the history areas include neighbours like Gatwick and Teterboro, and the detector works anywhere). It&apos;s tested leave-one-area-out (1.22–1.40 min off vs 3.4–4.5 for distance/speed) and runs on the 90 s worldwide feed. For &quot;which airport&quot;, a simple rule beat a trained classifier on unseen areas, so the rule is what runs.</li>
                <li><b>Live scoring:</b> <code>score_predictions.py</code> matches each logged prediction (one per plane per 30 s) to the landing <code>events.py</code> finds in the same logs. First run: 0.83 / 0.80 / 1.06 min off at Logan / JFK / Heathrow vs 3.3–4.6 for distance/speed. But 26% / 59% / 37% of predictions were for planes that never landed there.</li>
                <li><b>Next:</b> an &quot;is it landing here?&quot; classifier trained on every plane that came within 40 nm in the history, landed or not, to replace the hand-written arrival check.</li>
              </ul>
            </Dev>
          </Section>

          <Section id="privacy" title="Privacy and fair use">
            <p>
              <b>You:</b> there are no accounts, cookies, ads or analytics. Ask Flive chats only exist in your browser tab.
              The server uses your question to answer it and doesn&apos;t save it.
            </p>
            <p>
              <b>The planes:</b> everything here is broadcast openly by the aircraft and is already on plenty of flight-tracking
              sites. Flive shows the callsign, plus the registration and aircraft type from a public aircraft database. It never
              shows owners (the database has owner names, and for private planes that&apos;s often a person, so I don&apos;t use that
              field) or anything about passengers. Planes whose owners signed up for the FAA&apos;s privacy programs only show
              their type, with no registration or photo.
            </p>
            <p>
              <b>adsb.fi:</b> it&apos;s run by volunteers, so I try to be a good user. The server asks once every 5 seconds for
              everyone combined, backs off when told to, and credits adsb.fi on every page.
            </p>
          </Section>

          <Section id="stack" title="What it's built with">
            <ul>
              <li><b>Data:</b> adsb.fi open data (Boston, every 5 s) and the OpenSky Network (world, about every 90 s; arrival records planned for checking predictions)</li>
              <li><b>Aircraft details:</b> tar1090-db / Mictronics (types and registrations), OpenFlights (airline names, ODbL), Planespotters.net (photos, credited on each one), Jxck-S/airline-logos (logos; trademarks belong to the airlines)</li>
              <li><b>Server:</b> Python 3.11, FastAPI, WebSockets, requests, python-dotenv</li>
              <li><b>Frontend:</b> React, TypeScript, Vite, MapLibre GL, the Inter font</li>
              <li><b>Map:</b> OpenFreeMap vector tiles, © OpenMapTiles, © OpenStreetMap contributors, recoloured to dark navy</li>
              <li><b>AI:</b> Ollama running an open-weights LLM locally, with tool calling</li>
              <li><b>Code:</b> <a href={REPO} target="_blank" rel="noopener noreferrer">github.com/thakurnilesh307/Flive</a></li>
            </ul>
            <Dev title="Run it yourself">
              <pre>{`python -m pip install -r requirements.txt
cd frontend; npm install; npm run build; cd ..
# optional, for Ask Flive:
ollama pull qwen3:8b
python -m uvicorn server:app      # http://127.0.0.1:8000`}</pre>
              <p>Endpoints: <code>GET /ws</code> (WebSocket snapshots), <code>POST /api/ask</code>, <code>GET /api/ask/status</code>.</p>
            </Dev>
          </Section>

          <Section id="faq" title="FAQ">
            <div className="faq">
              <details><summary>Why can&apos;t I find a specific flight?</summary>
                <p>It might be outside the 40 nm circle, not near a volunteer receiver yet, or not broadcasting ADS-B at all (some military and older planes don&apos;t). Flive also shows planes by their radio callsign (like JBU470), which isn&apos;t always the flight number on your ticket.</p></details>
              <details><summary>Why did landing planes used to show a negative altitude?</summary>
                <p>Planes broadcast barometric altitude, which is calculated from air pressure assuming a &quot;standard&quot; day. On a high-pressure morning that reads too low, so a plane on the runway could show &quot;-400 ft&quot;. Pilots fix this by dialling the local pressure into their altimeter, and Flive now does the same: every 10 minutes the server grabs the latest weather report (METAR) from about 4,800 airports and corrects each low plane with the nearest one. Planes far out over the ocean, with no weather station nearby, still show the raw value.</p></details>
              <details><summary>Is this what air traffic control sees?</summary>
                <p>No. Controllers use radar and certified systems with full coverage. Flive runs on volunteer receivers and is just for curiosity and learning. Please don&apos;t use it for navigation or anything safety-related.</p></details>
              <details><summary>How accurate are the &quot;inbound&quot; and &quot;on approach&quot; labels?</summary>
                <p>Usually right for airliners near Logan, sometimes wrong for small planes going to nearby airports. They come from simple rules, and replacing them with real detection is the next thing on my list.</p></details>
              <details><summary>Why is Ask Flive sometimes offline or slow?</summary>
                <p>It runs a full language model on my own machine instead of a paid cloud service. If the model isn&apos;t running, the chat tells you and the map still works. Answers take a few seconds, longer if a few people ask at once.</p></details>
            </div>
          </Section>

          <Section id="glossary" title="Glossary">
            <dl className="glossary">
              <dt>ADS-B</dt><dd>Automatic Dependent Surveillance–Broadcast: the radio messages planes send with their ID, position and movement.</dd>
              <dt>Callsign</dt><dd>The name a flight uses on the radio, e.g. JBU470 = JetBlue flight 470.</dd>
              <dt>Registration</dt><dd>The plane&apos;s &quot;licence plate&quot;, e.g. N828JB. US ones start with N.</dd>
              <dt>ICAO hex</dt><dd>A permanent 24-bit address built into the transponder, shown as six characters like a1b2c3.</dd>
              <dt>Squawk</dt><dd>A four-digit code air traffic control gives a plane so they can identify it.</dd>
              <dt>Groundspeed</dt><dd>Speed over the ground in knots (1 knot ≈ 1.15 mph). Wind makes it different from airspeed.</dd>
              <dt>Track</dt><dd>The direction the plane is actually moving over the ground, in degrees (0° = north, 90° = east).</dd>
              <dt>Nautical mile (nm)</dt><dd>1.15 regular miles, or 1.852 km. The standard distance unit in aviation.</dd>
              <dt>MLAT</dt><dd>Multilateration: finding a plane from when its signal reaches several receivers.</dd>
              <dt>KBOS</dt><dd>The ICAO code for Boston Logan.</dd>
              <dt>LLM</dt><dd>Large language model, the kind of AI that writes text. Ask Flive uses one with tool calling.</dd>
              <dt>Tool calling</dt><dd>Letting an AI ask a program for specific data instead of answering from memory.</dd>
            </dl>
          </Section>

          <footer className="about-foot">
            <p>
              Flive is a personal project. Aircraft data from <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer">adsb.fi</a> and
              the <a href="https://opensky-network.org" target="_blank" rel="noopener noreferrer">OpenSky Network</a>.
              Photos from <a href="https://www.planespotters.net" target="_blank" rel="noopener noreferrer">Planespotters.net</a>, airline names from
              {" "}<a href="https://openflights.org/data" target="_blank" rel="noopener noreferrer">OpenFlights</a>.
              Map <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a>
              {" "}© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors.
              Not for navigation.
            </p>
            <a className="btn-primary small" href="/">Back to the map</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
