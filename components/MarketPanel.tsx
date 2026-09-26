"use client";

import { useState } from "react";
import { useNow, usePolling } from "@/lib/hooks";
import { fetchMarkets, tseSession, type Quote } from "@/lib/market";
import { Empty, Panel } from "./Panel";

const num = (v: number, d = 2) => v.toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });
const hm = (t: number) =>
  new Date(t).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

function Sparkline({ q, up }: { q: Quote; up: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = q.points;
  if (pts.length < 2) return <div className="spark empty-spark">チャートデータなし</div>;
  const W = 300;
  const H = 64;
  const vals = pts.map((p) => p.v).concat(q.prevClose ?? []);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min) * 0.08 || 1;
  const y = (v: number) => H - ((v - min + pad) / (max - min + pad * 2)) * H;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const hp = hover != null ? pts[hover] : null;

  return (
    <div className="spark">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1));
          setHover(Math.max(0, Math.min(pts.length - 1, i)));
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${q.name} の値動き`}
      >
        {q.prevClose != null && (
          <line className="spark-base" x1={0} x2={W} y1={y(q.prevClose)} y2={y(q.prevClose)} vectorEffect="non-scaling-stroke" />
        )}
        <path d={`${d}L${W},${H}L0,${H}Z`} className={`spark-area ${up ? "up" : "down"}`} />
        <path d={d} className={`spark-line ${up ? "up" : "down"}`} vectorEffect="non-scaling-stroke" />
        {hp && (
          <line className="spark-cross" x1={x(hover!)} x2={x(hover!)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {hp && (
        <div className="spark-tip" style={{ left: `${(hover! / (pts.length - 1)) * 100}%` }}>
          <b>{num(hp.v)}</b> {q.source.includes("日足") ? new Date(hp.t).toLocaleDateString("ja-JP") : hm(hp.t)}
        </div>
      )}
    </div>
  );
}

export function MarketPanel() {
  const feed = usePolling(fetchMarkets, 60 * 1000);
  const now = useNow(30_000);
  const session = now ? tseSession(now) : null;

  return (
    <Panel
      title="マーケット"
      sub={session && <span className={`session ${session.open ? "open" : ""}`}>● 東証 {session.label}</span>}
      updatedAt={feed.updatedAt}
      error={feed.error}
      loading={feed.loading}
      onRefresh={feed.refresh}
      className="market"
    >
      {!feed.data ? (
        <Empty error={feed.error} loading={feed.loading} />
      ) : (
        <div className="quotes">
          {feed.data.map((q) => {
            const ok = !isNaN(q.price);
            const chg = ok && q.prevClose != null ? q.price - q.prevClose : null;
            const pct = chg != null && q.prevClose ? (chg / q.prevClose) * 100 : null;
            const up = (chg ?? 0) >= 0;
            return (
              <div className="quote" key={q.name}>
                <div className="quote-head">
                  <span className="quote-name">{q.name}</span>
                  <span className="quote-time">
                    {q.time ? q.time.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                </div>
                <div className="quote-main">
                  <span className="quote-price">{ok ? num(q.price) : "—"}</span>
                  {chg != null && (
                    <span className={`quote-chg ${up ? "up" : "down"}`}>
                      {up ? "▲" : "▼"} {up ? "+" : ""}
                      {num(chg)} ({up ? "+" : ""}
                      {pct!.toFixed(2)}%)
                    </span>
                  )}
                </div>
                <Sparkline q={q} up={up} />
                <div className="quote-foot">
                  <span>前日終値 {q.prevClose != null ? num(q.prevClose) : "—"}</span>
                  <span>{q.source}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
