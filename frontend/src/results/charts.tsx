// Small hand-drawn SVG charts for the results page: a line chart with a crosshair
// readout, grouped bars with per-bar readouts, and the table view behind both.
// Thin marks, hairline grid, a legend for 2+ series, and every value reachable
// without hovering (the table). Colours come from CSS tokens (--s1..--s4) so the
// light and dark themes each get their own validated steps.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface Series {
  name: string;
  color: string;            // a CSS token, e.g. "var(--s1)"
  values: (number | null)[];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Clean y ticks from `min` (default 0) to just above `max`. */
function ticks(max: number, count = 4, min = 0): number[] {
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = min; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  if (out[out.length - 1] < max) out.push(Math.round((out[out.length - 1] + step) * 1000) / 1000);
  return out;
}

const fmt = (v: number | null | undefined, unit = "", digits = 1) =>
  v == null ? "-" : `${v.toFixed(digits)}${unit}`;

export function Legend({ series, kind }: { series: { name: string; color: string }[]; kind: "line" | "bar" }) {
  if (series.length < 2) return null;
  return (
    <ul className="legend">
      {series.map((s) => (
        <li key={s.name}>
          <span className={`key key-${kind}`} style={{ background: s.color }} aria-hidden="true" />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ x, y, width, title, rows }: {
  x: number; y: number; width: number; title: string; rows: { name: string; color: string; value: string }[];
}) {
  const left = Math.min(Math.max(x + 12, 0), Math.max(0, width - 190));
  return (
    <div className="tip" style={{ left, top: Math.max(0, y) }} role="status">
      <div className="tip-title">{title}</div>
      {rows.map((r) => (
        <div className="tip-row" key={r.name}>
          <span className="tip-key" style={{ background: r.color }} aria-hidden="true" />
          <b>{r.value}</b>
          <span>{r.name}</span>
        </div>
      ))}
    </div>
  );
}

export function LineChart({ x, xValues, series, unit, digits = 1, yMin = 0, yMax, tickCount = 4, xTitle, height = 240, label, endLabels = true }: {
  x: string[]; series: Series[]; unit: string; digits?: number; yMin?: number; yMax?: number; xTitle?: string;
  height?: number; label: string; tickCount?: number;
  /** numeric x positions (e.g. days 0, 1, 3, 7, 10) for a true-to-scale axis; default: evenly spaced */
  xValues?: number[];
  /** names at the line ends (skipped anyway when they'd collide); off for narrow small multiples */
  endLabels?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const yt = ticks(yMax ?? Math.max(...all, 0.1), tickCount, yMin);
  const top = yt[yt.length - 1];
  const directLabels = endLabels && series.length >= 2 && series.length <= 4;
  const m = { l: 40, r: directLabels ? 78 : 14, t: 12, b: xTitle ? 44 : 28 };
  const iw = Math.max(10, width - m.l - m.r), ih = height - m.t - m.b;
  const x0 = xValues ? xValues[0] : 0, x1 = xValues ? xValues[xValues.length - 1] : x.length - 1;
  const px = (i: number) => m.l + (x1 === x0 ? iw / 2 : (((xValues ? xValues[i] : i) - x0) * iw) / (x1 - x0));
  const py = (v: number) => m.t + ih - ((v - yMin) / (top - yMin)) * ih;
  const sparse = x.length <= 12;

  // End labels only when they don't collide; otherwise the legend carries identity.
  const ends = series.map((s) => {
    let i = s.values.length - 1;
    while (i >= 0 && s.values[i] == null) i--;
    return i >= 0 ? { name: s.name, i, y: py(s.values[i] as number) } : null;
  });
  const ys = ends.filter(Boolean).map((e) => e!.y).sort((a, b) => a - b);
  const labelsFit = directLabels && ys.every((y, i) => i === 0 || y - ys[i - 1] >= 14);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const at = m.l + ((e.clientX - r.left) / r.width) * iw;
    let best = 0;
    x.forEach((_, i) => { if (Math.abs(px(i) - at) < Math.abs(px(best) - at)) best = i; });
    setHover(best);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(x.length - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? x.length) - 1));
    else return;
    e.preventDefault();
  };
  const labelEvery = Math.ceil(x.length / Math.max(2, Math.floor(iw / 44)));

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} tabIndex={0}
             onKeyDown={onKey} onBlur={() => setHover(null)}>
          {yt.map((t) => (
            <g key={t}>
              <line className="grid" x1={m.l} x2={m.l + iw} y1={py(t)} y2={py(t)} />
              <text className="tick" x={m.l - 8} y={py(t)} dy="0.32em" textAnchor="end">{t}</text>
            </g>
          ))}
          {x.map((l, i) => (xValues || i % labelEvery === 0) && (
            <text key={l} className="tick" x={px(i)} y={m.t + ih + 18} textAnchor="middle">{l}</text>
          ))}
          {xTitle && <text className="axis-title" x={m.l + iw / 2} y={height - 6} textAnchor="middle">{xTitle}</text>}
          {hover != null && <line className="crosshair" x1={px(hover)} x2={px(hover)} y1={m.t} y2={m.t + ih} />}
          {series.map((s) => {
            const segs: string[] = [];
            let d = "";
            s.values.forEach((v, i) => {
              if (v == null) { if (d) segs.push(d); d = ""; return; }
              d += `${d ? "L" : "M"}${px(i)},${py(v)}`;
            });
            if (d) segs.push(d);
            return (
              <g key={s.name}>
                {segs.map((p, k) => <path key={k} d={p} className="line" style={{ stroke: s.color }} />)}
                {s.values.map((v, i) => v != null && (sparse || i === ends.find((e) => e?.name === s.name)?.i || i === hover) && (
                  <circle key={i} cx={px(i)} cy={py(v)} r={4} className="dot" style={{ fill: s.color }} />
                ))}
              </g>
            );
          })}
          {labelsFit && ends.map((e) => e && (
            <text key={e.name} className="end-label" x={px(e.i) + 9} y={e.y} dy="0.32em">{e.name}</text>
          ))}
          <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent"
                onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hover != null && width > 0 && (
        <Tooltip x={px(hover)} y={m.t} width={width} title={xTitle ? `${x[hover]} (${xTitle.toLowerCase()})` : x[hover]}
                 rows={series.map((s) => ({ name: s.name, color: s.color, value: fmt(s.values[hover], unit, digits) }))} />
      )}
    </div>
  );
}

export function GroupedBars({ groups, series, unit, digits = 1, yMax, xTitle, height = 240, label }: {
  groups: string[]; series: Series[]; unit: string; digits?: number; yMax?: number; xTitle?: string;
  height?: number; label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ g: number; s: number } | null>(null);
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const yt = ticks(yMax ?? Math.max(...all, 0.1));
  const top = yt[yt.length - 1];
  const m = { l: 40, r: 8, t: 12, b: xTitle ? 44 : 28 };
  const iw = Math.max(10, width - m.l - m.r), ih = height - m.t - m.b;
  const band = iw / groups.length;
  const gap = 2;
  const bw = Math.max(3, Math.min(24, (band * 0.8 - gap * (series.length - 1)) / series.length));
  const groupW = bw * series.length + gap * (series.length - 1);
  const py = (v: number) => m.t + ih - (v / top) * ih;
  const bx = (g: number, s: number) => m.l + g * band + (band - groupW) / 2 + s * (bw + gap);

  const bar = (x0: number, v: number) => {
    const y0 = py(v), yb = m.t + ih, r = Math.min(4, bw / 2, yb - y0);
    return `M${x0},${yb}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${yb}Z`;
  };

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="group" aria-label={label}>
          {yt.map((t) => (
            <g key={t}>
              <line className="grid" x1={m.l} x2={m.l + iw} y1={py(t)} y2={py(t)} />
              <text className="tick" x={m.l - 8} y={py(t)} dy="0.32em" textAnchor="end">{t}</text>
            </g>
          ))}
          {groups.map((g, gi) => (
            <text key={g} className="tick" x={m.l + gi * band + band / 2} y={m.t + ih + 18} textAnchor="middle">{g}</text>
          ))}
          {xTitle && <text className="axis-title" x={m.l + iw / 2} y={height - 6} textAnchor="middle">{xTitle}</text>}
          {series.map((s, si) => groups.map((g, gi) => {
            const v = s.values[gi];
            if (v == null) return null;
            const on = hover?.g === gi && hover?.s === si;
            return (
              <g key={`${si}-${gi}`}>
                <path d={bar(bx(gi, si), v)} className={`bar ${hover && !on ? "dim" : ""}`} style={{ fill: s.color }} />
                {/* hit area: the whole column above the bar, wider than the painted mark */}
                <rect x={bx(gi, si) - gap / 2} y={m.t} width={bw + gap} height={ih} fill="transparent" tabIndex={0}
                      aria-label={`${g}, ${s.name}: ${fmt(v, unit, digits)}`}
                      onPointerEnter={() => setHover({ g: gi, s: si })} onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover({ g: gi, s: si })} onBlur={() => setHover(null)} />
              </g>
            );
          }))}
          <line className="baseline" x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} />
        </svg>
      )}
      {hover && width > 0 && (
        <Tooltip x={bx(hover.g, hover.s)} y={py(series[hover.s].values[hover.g] ?? 0) - 64} width={width}
                 title={groups[hover.g]}
                 rows={[{ name: series[hover.s].name, color: series[hover.s].color,
                          value: fmt(series[hover.s].values[hover.g], unit, digits) }]} />
      )}
    </div>
  );
}

/** The table view: every value in the charts above, no hovering needed. */
export function DataTable({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption: string }) {
  return (
    <details className="numbers">
      <summary>Show the numbers</summary>
      <div className="table-wrap">
        <table>
          <caption>{caption}</caption>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}
