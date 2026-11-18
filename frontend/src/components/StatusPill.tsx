import { STATUS_LABEL, type FlightStatus } from "../status";

export default function StatusPill({ status, large = false }: { status: FlightStatus; large?: boolean }) {
  return (
    <span className={`pill pill-${status} ${large ? "pill-lg" : ""}`}>
      <span className="pill-dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}
