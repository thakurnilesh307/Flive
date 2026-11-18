import { PlaneGlyph } from "./icons";

interface Props {
  tracked: number;
  inbound: number;
  approach: number;
}

export default function StatsCard({ tracked, inbound, approach }: Props) {
  return (
    <section className="panel stats" aria-label="Traffic summary">
      <div className="stat">
        <PlaneGlyph size={26} rotate={60} className="stat-icon blue" />
        <div><b>{tracked}</b><span>Aircraft tracked</span></div>
      </div>
      <div className="stat" title="Descending toward Logan within 40 nm (estimated from track and descent)">
        <PlaneGlyph size={26} rotate={120} className="stat-icon cyan" />
        <div><b>{inbound}</b><span>Inbound</span></div>
      </div>
      <div className="stat" title="Within 15 nm, below 5,000 ft and descending toward Logan (estimated)">
        <PlaneGlyph size={26} rotate={150} className="stat-icon amber" />
        <div><b>{approach}</b><span>On approach</span></div>
      </div>
    </section>
  );
}
