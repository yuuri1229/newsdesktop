"use client";

import { useCorrectedClock, useTimeSync, type TimeSync } from "@/lib/timesync";

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions, locale = "ja-JP") =>
  new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", ...opts }).format(d);

const WORLD = [
  { label: "UTC", tz: "UTC" },
  { label: "ロンドン", tz: "Europe/London" },
  { label: "ニューヨーク", tz: "America/New_York" },
  { label: "北京", tz: "Asia/Shanghai" },
];

const sec = (ms: number, digits = 2) => `${(ms / 1000).toFixed(digits)}秒`;
const signed = (ms: number) => `${ms >= 0 ? "+" : "−"}${sec(Math.abs(ms))}`;
const msStr = (ms: number) => `${Math.round(ms)}ms`;

function SyncStatus({ sync, lag }: { sync: TimeSync; lag: number }) {
  if (sync.status === "syncing" && !sync.samples)
    return <div className="sync sync-wait">⟳ 日本標準時と同期中…（端末の時計で表示）</div>;
  if (sync.status === "failed")
    return <div className="sync sync-bad">⚠ 時刻サーバーに接続できません（端末の時計で表示・誤差不明）</div>;

  // 表示誤差 = 同期誤差 (RTT/2 + 分解能) + 描画の遅れ
  const total = sync.accuracy + lag;
  const level = total < 100 ? "good" : total < 500 ? "warn" : "bad";
  const levelLabel = level === "good" ? "✓ 高精度" : level === "warn" ? "△ 注意" : "⚠ 低精度";
  const last = sync.lastSync ? fmt(new Date(sync.lastSync), { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  return (
    <div
      className={`sync sync-${level}`}
      title={`${sync.source} と ${sync.samples} 回計測（直近の最小遅延サンプルを採用）/ 最終同期 ${last}`}
    >
      <div className="sync-main">
        <span className="sync-badge">{levelLabel}</span>
        <span>
          {sync.source}同期 誤差 <b>±{sec(total)}</b>
        </span>
        <span className="sync-last">最終同期 {last}</span>
      </div>
      <dl className="sync-grid">
        <div>
          <dt>端末時計のずれ</dt>
          <dd>{signed(sync.deviceDrift)}</dd>
        </div>
        <div>
          <dt>通信遅延(RTT)</dt>
          <dd>{msStr(sync.rtt)}</dd>
        </div>
        <div>
          <dt>ジッター</dt>
          <dd>{sync.samples > 1 ? `±${msStr(sync.jitter)}` : "計測中"}</dd>
        </div>
        <div>
          <dt>表示遅延</dt>
          <dd>{msStr(lag)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function Clock() {
  const sync = useTimeSync();
  const { now, lag } = useCorrectedClock(sync.offset);
  if (!now) return <section className="panel clock" />;
  const time = fmt(now, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const [hm, s] = [time.slice(0, 5), time.slice(6)];
  return (
    <section className="panel clock" aria-label="日本標準時">
      <div className="clock-label">日本標準時 JST (UTC+9)</div>
      <div className="clock-time">
        {hm}
        <span className="clock-sec">:{s}</span>
      </div>
      <div className="clock-date">
        {fmt(now, { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
        <span className="clock-era">{fmt(now, { era: "long", year: "numeric" }, "ja-JP-u-ca-japanese")}</span>
      </div>
      <SyncStatus sync={sync} lag={lag} />
      <div className="world">
        {WORLD.map((w) => (
          <div key={w.tz}>
            <span>{w.label}</span>
            <b>{new Intl.DateTimeFormat("ja-JP", { timeZone: w.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now)}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
