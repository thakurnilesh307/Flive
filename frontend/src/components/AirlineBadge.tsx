import { useState } from "react";
import { badgeHue, type Operator } from "../airlines";

// Codes the server had no logo for, so every row doesn't retry the same 404.
const noLogo = new Set<string>();
const hasLogoCode = (code: string) => /^[A-Z]{3}$/.test(code) && !noLogo.has(code);

/**
 * The airline's real logo (served and cached by our own server at /api/logo/ICAO),
 * falling back to a plain tinted square with the code when there isn't one.
 */
export default function AirlineBadge({ op, size = 48, className = "" }: { op: Operator; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showLogo = !failed && hasLogoCode(op.code) && op.name !== "Unknown operator";
  const style = { width: size, height: size } as React.CSSProperties;

  if (showLogo) {
    return (
      <span className={`badge badge-logo ${className}`} style={style}>
        <img
          src={`/api/logo/${op.code}`}
          alt={op.name}
          width={size}
          height={size}
          loading="lazy"
          onError={() => { noLogo.add(op.code); setFailed(true); }}
        />
      </span>
    );
  }
  return (
    <span
      className={`badge ${className}`}
      style={{ ...style, "--hue": badgeHue(op.code), fontSize: Math.max(8, Math.round(size * 0.27)) } as React.CSSProperties}
      aria-hidden={size < 30}
    >
      {size < 30 ? op.code.slice(0, 2) : op.code}
    </span>
  );
}
