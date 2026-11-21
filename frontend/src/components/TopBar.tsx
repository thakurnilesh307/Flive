import { SearchIcon, CloseIcon } from "./icons";
import { localTime } from "../format";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  onSubmit: () => void;
  live: boolean;
  now: number;
  chatOpen: boolean;
  onToggleChat: () => void;
  askEnabled: boolean;
  /** airport at the middle of the map (when zoomed in) */
  place: { code: string; name: string } | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export default function TopBar({ query, onQuery, onSubmit, live, now, chatOpen, onToggleChat, askEnabled, place, theme, onToggleTheme }: Props) {
  return (
    <header className="topbar">
      <a className="brand" href="/">
        <b>FLIVE</b>
        <span>live arrivals at BOS, JFK and LHR</span>
      </a>

      <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <SearchIcon size={15} />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Callsign, airline or airport"
          aria-label="Search flights and airports"
          maxLength={40}
        />
        {query && (
          <button type="button" className="icon-btn ghost" onClick={() => onQuery("")} aria-label="Clear search">
            <CloseIcon size={14} />
          </button>
        )}
      </form>

      <div className="topbar-right">
        <div className={`live ${live ? "on" : ""}`} aria-live="polite">
          <span className="dot" />
          <span className="live-text">{live ? "live" : "reconnecting"}</span>
          <span className="live-time">{localTime(now)}</span>
        </div>
        {askEnabled && (
          <button className={`text-btn ${chatOpen ? "active" : ""}`} onClick={onToggleChat} aria-pressed={chatOpen}>
            Ask
          </button>
        )}
        <a className="text-btn" href="/results.html">Results</a>
        <a className="text-btn" href="/about.html">About</a>
        <button
          className="text-btn"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        {place && <div className="airport-pill" title={`Map is centred near ${place.name}`}>{place.code}</div>}
      </div>
    </header>
  );
}
