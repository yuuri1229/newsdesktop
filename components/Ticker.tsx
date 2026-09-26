"use client";

import type { NewsItem } from "@/lib/rss";

/** 画面下部の速報テロップ。直近 1 時間以内のニュースを優先表示。 */
export function Ticker({ items }: { items: NewsItem[] }) {
  const now = Date.now();
  const recent = items.filter((i) => i.date && now - i.date.getTime() < 60 * 60 * 1000);
  const list = (recent.length >= 3 ? recent : items).slice(0, 12);
  if (!list.length) return <footer className="ticker"><span className="ticker-tag">速報</span></footer>;
  const duration = Math.max(40, list.length * 9);
  return (
    <footer className="ticker">
      <span className="ticker-tag">{recent.length ? "速報" : "最新"}</span>
      <div className="ticker-track">
        <div className="ticker-move" style={{ animationDuration: `${duration}s` }}>
          {[0, 1].map((k) => (
            <span key={k} aria-hidden={k === 1}>
              {list.map((i) => (
                <a key={(i.link || i.title) + k} href={i.link} target="_blank" rel="noreferrer">
                  <time>
                    {i.date?.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" })}
                  </time>
                  {i.title}
                </a>
              ))}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
