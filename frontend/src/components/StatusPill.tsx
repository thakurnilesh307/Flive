import { STATUS_LABEL, type FlightStatus } from "../status";

// One small glyph per status, showing what the plane is doing: coming down,
// heading in, climbing out, cruising past, or on the ground.
const GLYPH: Record<FlightStatus, string> = {
  approach: "M3 4 L12 13 M12 6 V13 H5",   // steep down arrow
  inbound: "M2 6 L12 11 M8 12.5 L12 11 L10.5 7", // shallow down arrow
  departing: "M3 13 L12 4 M5 4 H12 V11",  // up arrow
  enroute: "M2 8 H13 M9.5 4.5 L13 8 L9.5 11.5", // level arrow
  taxiing: "M2 12 H14 M5 9 H11",          // on the ground, moving
  ground: "M2 12 H14",                    // on the ground
};

export default function StatusPill({ status, large = false }: { status: FlightStatus; large?: boolean }) {
  const size = large ? 16 : 14;
  return (
    <span className={`status status-${status} ${large ? "status-lg" : ""}`}>
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <path d={GLYPH[status]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="status-text">{STATUS_LABEL[status]}</span>
    </span>
  );
}
