// Plane silhouette pointing north in a 24x24 box (rotated by track on the map).
export const PLANE_PATH =
  "M12 2.5c.9 0 1.4 1 1.4 2.2v4.9l7.1 4.3v1.9l-7.1-2.2v4.5l2 1.5v1.4L12 20.2l-3.4.8v-1.4l2-1.5v-4.5l-7.1 2.2v-1.9l7.1-4.3V4.7c0-1.2.5-2.2 1.4-2.2z";

type P = { size?: number; className?: string };

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
export const SparkIcon = (p: P) => (
  <Svg {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></Svg>
);


