import { Logo, SearchIcon, CloseIcon, SparkIcon, InfoIcon } from "./icons";
import { bostonTime } from "../format";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  onSubmit: () => void;
  live: boolean;
  now: number;
  chatOpen: boolean;
  onToggleChat: () => void;
}

export default function TopBar({ query, onQuery, onSubmit, live, now, chatOpen, onToggleChat }: Props) {
  return (
    <header className="topbar">
      <div className="brand">
        <Logo size={34} />
        <span>Flive</span>
      </div>

      <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <SearchIcon size={18} />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search flights, callsigns, airlines, types…"
          aria-label="Search aircraft"
          maxLength={40}
        />
        {query && (
          <button type="button" className="icon-btn ghost" onClick={() => onQuery("")} aria-label="Clear search">
            <CloseIcon size={16} />
          </button>
        )}
      </form>

      <div className="topbar-right">
        <div className={`live ${live ? "on" : ""}`} aria-live="polite">
          <span className="dot" />
          <span className="live-text">{live ? "Live" : "Reconnecting"}</span>
          <span className="live-time">· {bostonTime(now)}</span>
        </div>
        <button className={`ask-btn ${chatOpen ? "active" : ""}`} onClick={onToggleChat} aria-pressed={chatOpen}>
          <SparkIcon size={17} /><span>Ask Flive</span>
        </button>
        <a className="about-link" href="/about.html" aria-label="About Flive">
          <InfoIcon size={17} /><span>About</span>
        </a>
        <div className="airport-pill" title="Boston Logan International">KBOS</div>
      </div>
    </header>
  );
}
