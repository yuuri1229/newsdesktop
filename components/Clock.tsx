"use client";

import { useNow } from "@/lib/hooks";

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions, locale = "ja-JP") =>
  new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", ...opts }).format(d);

const WORLD = [
  { label: "UTC", tz: "UTC" },
  { label: "ロンドン", tz: "Europe/London" },
  { label: "ニューヨーク", tz: "America/New_York" },
  { label: "北京", tz: "Asia/Shanghai" },
];

export function Clock() {
  const now = useNow(250);
  if (!now) return <section className="panel clock" />;
  const time = fmt(now, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const [hm, sec] = [time.slice(0, 5), time.slice(6)];
  return (
    <section className="panel clock" aria-label="日本標準時">
      <div className="clock-label">日本標準時 JST (UTC+9)</div>
      <div className="clock-time">
        {hm}
        <span className="clock-sec">:{sec}</span>
      </div>
      <div className="clock-date">
        {fmt(now, { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
        <span className="clock-era">{fmt(now, { era: "long", year: "numeric" }, "ja-JP-u-ca-japanese")}</span>
      </div>
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
