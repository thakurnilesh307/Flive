// Top bar shared by the About and Results pages (same look as the map's).
export const REPO = "https://github.com/thakurnilesh307/Flive";

export default function TopNav({ here }: { here: "about" | "results" }) {
  return (
    <header className="about-top">
      <a className="about-brand" href="/"><b>FLIVE</b></a>
      <nav className="about-top-links">
        <a href="/">Map</a>
        <a href="/results.html" className={here === "results" ? "here" : ""}>Results</a>
        <a href="/about.html" className={here === "about" ? "here" : ""}>About</a>
        <a href={REPO} className="gh" target="_blank" rel="noopener noreferrer">GitHub</a>
      </nav>
    </header>
  );
}
