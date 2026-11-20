// Plane silhouette pointing north in a 24x24 box (rotated by track on the map).
export const PLANE_PATH =
  "M12 2.5c.9 0 1.4 1 1.4 2.2v4.9l7.1 4.3v1.9l-7.1-2.2v4.5l2 1.5v1.4L12 20.2l-3.4.8v-1.4l2-1.5v-4.5l-7.1 2.2v-1.9l7.1-4.3V4.7c0-1.2.5-2.2 1.4-2.2z";

type P = { size?: number; className?: string };

export function Logo({ size = 36 }: P) {
  // Same artwork as public/favicon.svg. Gradient/clip ids are prefixed to stay unique.
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="flive-logo-g" x1="8" y1="54" x2="56" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4b37c4" />
          <stop offset="1" stopColor="#3b97fa" />
        </linearGradient>
        <clipPath id="flive-logo-clip">
          <path d="M32 2 58 17v30L32 62 6 47V17z" />
        </clipPath>
      </defs>
      <polygon
        points="32,5 55.4,18.5 55.4,45.5 32,59 8.6,45.5 8.6,18.5"
        fill="url(#flive-logo-g)" stroke="url(#flive-logo-g)" strokeWidth="6" strokeLinejoin="round"
      />
      <g clipPath="url(#flive-logo-clip)" stroke="#d9d4ff" strokeOpacity=".8" strokeWidth="3.4" strokeLinecap="round">
        <line x1="2" y1="47.5" x2="26.5" y2="33.5" />
        <line x1="6" y1="54" x2="29" y2="40.5" />
      </g>
      <path fill="#fff" transform="translate(39 27.5) rotate(60) scale(1.2) translate(-12 -12)" d={PLANE_PATH} />
    </svg>
  );
}

const Svg = ({ size = 18, className, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);

export const SearchIcon = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>;
export const CloseIcon = (p: P) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const PlusIcon = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const MinusIcon = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>;
export const LocateIcon = (p: P) => <Svg {...p}><path d="M3 11 21 3l-8 18-2-8-8-2z" /></Svg>;
export const ChevronIcon = (p: P) => <Svg {...p}><path d="m6 15 6-6 6 6" /></Svg>;
export const SendIcon = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const ChartIcon = (p: P) => <Svg {...p}><path d="M4 20h16M7 16v-5M12 16V6M17 16v-8" /></Svg>;
export const InfoIcon = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
export const SparkIcon = (p: P) => (
  <Svg {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></Svg>
);
export const RunwayIcon = (p: P) => (
  <Svg {...p}><path d="M8 3 4 21M16 3l4 18M12 4v2M12 10v3M12 17v3" /></Svg>
);

export const PlaneGlyph = ({ size = 20, rotate = 45, className }: P & { rotate?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="currentColor" transform={`rotate(${rotate} 12 12)`} d={PLANE_PATH} />
  </svg>
);

export const SunIcon = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>
);
export const MoonIcon = (p: P) => <Svg {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></Svg>;
