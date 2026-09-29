"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// 依存ライブラリなしの SVG グラフ。線 2px・面は 10% の塗り・罫線は 1px、ホバーでクロスヘア + ツールチップ。

export type Series = {
  label: string;
  /** CSS の色 (var(--series-1) など) */
  color: string;
  values: (number | null)[];
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const M = { l: 44, r: 12, t: 10, b: 22 };

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

/** 0 から始まるきりの良い目盛り */
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(10)));
  return ticks;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function timeTicks(from: number, to: number, width: number): { t: number; label: string }[] {
  const maxTicks = Math.max(2, Math.floor(width / 72));
  const steps = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];
  const step = steps.find((s) => (to - from) / s <= maxTicks) ?? 60 * DAY;
  const out: { t: number; label: string }[] = [];
  const d = new Date(from);
  if (step < DAY) {
    d.setMinutes(0, 0, 0);
    const h = step / HOUR;
    while (d.getTime() < from || d.getHours() % h) d.setHours(d.getHours() + 1);
    for (; d.getTime() <= to; d.setHours(d.getHours() + h)) {
      out.push({ t: d.getTime(), label: d.getHours() === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getHours()}:00` });
    }
  } else {
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < from) d.setDate(d.getDate() + 1);
    const days = Math.round(step / DAY);
    for (; d.getTime() <= to; d.setDate(d.getDate() + days)) out.push({ t: d.getTime(), label: `${d.getMonth() + 1}/${d.getDate()}` });
  }
  return out;
}

export const fmtTime = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad2(d.getMinutes())}`;
};

export function LineChart({
  times,
  series,
  from,
  to,
  gapMs,
  fmt,
  unit,
  height = 170,
  yMax,
}: {
  times: number[];
  series: Series[];
  from: number;
  to: number;
  /** この間隔より空いた点は線でつながない (計測していなかった時間) */
  gapMs: number;
  fmt: (v: number) => string;
  unit: string;
  height?: number;
  /** 固定の上限 (スコアなど) */
  yMax?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const max = useMemo(() => {
    let m = 0;
    for (const s of series) for (const v of s.values) if (v !== null && v > m) m = v;
    return m;
  }, [series]);
  const yTicks = yMax ? niceTicks(yMax, 4) : niceTicks(max * 1.08 || 1);
  const top = yTicks[yTicks.length - 1];

  const iw = Math.max(0, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const span = Math.max(1, to - from);
  const x = (t: number) => M.l + ((t - from) / span) * iw;
  const y = (v: number) => M.t + ih - (Math.min(v, top) / top) * ih;

  const paths = useMemo(
    () =>
      series.map((s) => {
        const segs: [number, number][][] = [];
        let cur: [number, number][] = [];
        let prevT = -Infinity;
        times.forEach((t, i) => {
          const v = s.values[i];
          if (v === null) return;
          if (t - prevT > gapMs && cur.length) {
            segs.push(cur);
            cur = [];
          }
          cur.push([x(t), y(v)]);
          prevT = t;
        });
        if (cur.length) segs.push(cur);
        const line = segs.map((seg) => "M" + seg.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L")).join("");
        const base = M.t + ih;
        const area = segs
          .filter((seg) => seg.length > 1)
          .map((seg) => `M${seg[0][0].toFixed(1)},${base}L` + seg.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L") + `L${seg[seg.length - 1][0].toFixed(1)},${base}Z`)
          .join("");
        // 前後とつながらない孤立点と最新点は点で示す
        const dots = segs.filter((seg) => seg.length === 1).map((seg) => seg[0]);
        const last = segs.at(-1)?.at(-1);
        if (last && !dots.includes(last)) dots.push(last);
        return { line, area, dots };
      }),
    [series, times, from, to, width, height, top, gapMs],
  );

  const idxAt = (px: number) => {
    let best = -1;
    let bd = Infinity;
    times.forEach((t, i) => {
      if (series.every((s) => s.values[i] === null)) return;
      const d = Math.abs(x(t) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best === -1 ? null : best;
  };
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    setHover(idxAt(e.clientX - rect.left));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!times.length) return;
    const valid = times.map((_, i) => i).filter((i) => series.some((s) => s.values[i] !== null));
    if (!valid.length) return;
    const pos = hover === null ? valid.length : valid.indexOf(hover);
    if (e.key === "ArrowLeft") setHover(valid[Math.max(0, pos - 1)]);
    else if (e.key === "ArrowRight") setHover(valid[Math.min(valid.length - 1, pos + 1)]);
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  const hx = hover !== null ? x(times[hover]) : 0;
  const hasData = series.some((s) => s.values.some((v) => v !== null));

  return (
    <div className="chart" ref={ref} tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)} aria-label={`${series.map((s) => s.label).join("・")}の推移 (${unit})`}>
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {yTicks.map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={M.l} x2={M.l + iw} y1={y(v)} y2={y(v)} />
              <text className="chart-tick" x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ))}
          <line className="chart-axis" x1={M.l} x2={M.l + iw} y1={M.t + ih} y2={M.t + ih} />
          {timeTicks(from, to, iw).map(({ t, label }) => (
            <text key={t} className="chart-tick" x={x(t)} y={height - 6} textAnchor="middle">
              {label}
            </text>
          ))}
          {paths.map((p, i) => (
            <g key={series[i].label} style={{ color: series[i].color }}>
              <path d={p.area} fill="currentColor" opacity={0.1} />
              <path d={p.line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {p.dots.map(([cx, cy], j) => (
                <circle key={j} className="chart-dot" cx={cx} cy={cy} r={4} fill="currentColor" />
              ))}
            </g>
          ))}
          {hover !== null && (
            <g>
              <line className="chart-cross" x1={hx} x2={hx} y1={M.t} y2={M.t + ih} />
              {series.map((s) => {
                const v = s.values[hover];
                return v === null ? null : <circle key={s.label} className="chart-dot" cx={hx} cy={y(v)} r={4.5} fill={s.color} />;
              })}
            </g>
          )}
          <rect
            x={M.l}
            y={0}
            width={iw}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {!hasData && <div className="chart-empty">この期間の計測データはありません</div>}
      {hover !== null && (
        <div className={`chart-tip ${hx > width / 2 ? "left" : ""}`} style={{ left: hx }}>
          <div className="chart-tip-time">{fmtTime(times[hover])}</div>
          {series.map((s) => (
            <div key={s.label} className="chart-tip-row">
              <i style={{ background: s.color }} />
              <b>{s.values[hover] === null ? "—" : fmt(s.values[hover] as number)}</b>
              <span>
                {unit} {series.length > 1 ? s.label : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 時間帯 (0〜23 時) 別の平均を縦棒で表示 */
export function HourBars({ values, fmt, unit, color, height = 170 }: { values: (number | null)[]; fmt: (v: number) => string; unit: string; color: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const yTicks = niceTicks(max * 1.08 || 1);
  const top = yTicks[yTicks.length - 1];
  const iw = Math.max(0, width - M.l - M.r);
  const ih = height - M.t - M.b;
  const band = iw / 24;
  const bw = Math.max(2, Math.min(24, band - 4));
  const y = (v: number) => M.t + ih - (v / top) * ih;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`時間帯別の平均 (${unit})`}>
          {yTicks.map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={M.l} x2={M.l + iw} y1={y(v)} y2={y(v)} />
              <text className="chart-tick" x={M.l - 6} y={y(v)} dy="0.32em" textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ))}
          <line className="chart-axis" x1={M.l} x2={M.l + iw} y1={M.t + ih} y2={M.t + ih} />
          {values.map((v, h) => {
            const cx = M.l + band * h + band / 2;
            const label = h % (band < 22 ? 6 : 3) === 0;
            return (
              <g key={h}>
                {label && (
                  <text className="chart-tick" x={cx} y={height - 6} textAnchor="middle">
                    {h}時
                  </text>
                )}
                {v !== null && v > 0 && <BarPath x={cx - bw / 2} y={y(v)} w={bw} h={M.t + ih - y(v)} color={color} active={hover === h} />}
                <rect
                  x={M.l + band * h}
                  y={M.t}
                  width={band}
                  height={ih}
                  fill="transparent"
                  tabIndex={v === null ? -1 : 0}
                  onPointerEnter={() => setHover(h)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(h)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {max === 0 && <div className="chart-empty">この期間の計測データはありません</div>}
      {hover !== null && (
        <div className={`chart-tip ${hover >= 12 ? "left" : ""}`} style={{ left: M.l + band * hover + band / 2 }}>
          <div className="chart-tip-time">
            {hover}:00〜{hover}:59 の平均
          </div>
          <div className="chart-tip-row">
            <i style={{ background: color }} />
            <b>{values[hover] === null ? "データなし" : fmt(values[hover] as number)}</b>
            <span>{values[hover] === null ? "" : unit}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 上端 4px 角丸・下端は直角の棒 */
function BarPath({ x, y, w, h, color, active }: { x: number; y: number; w: number; h: number; color: string; active: boolean }) {
  const r = Math.min(4, w / 2, h);
  const d = `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  return <path d={d} fill={color} opacity={active ? 0.75 : 1} />;
}
