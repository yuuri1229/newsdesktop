"use client";

import type { Polled } from "@/lib/hooks";
import type { NewsItem } from "@/lib/rss";
import { Empty, Panel } from "./Panel";

const NEW_MS = 60 * 60 * 1000;

function timeLabel(d: Date | null, now: number) {
  if (!d) return "";
  const diff = now - d.getTime();
  if (diff < 60_000) return "たった今";
  if (diff < NEW_MS) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 24 * NEW_MS)
    return d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
}

export function NewsPanel({
  title,
  sub,
  feed,
  className,
}: {
  title: string;
  sub?: React.ReactNode;
  feed: Polled<NewsItem[]>;
  className?: string;
}) {
  const now = Date.now();
  return (
    <Panel
      title={title}
      sub={sub}
      updatedAt={feed.updatedAt}
      error={feed.error}
      loading={feed.loading}
      onRefresh={feed.refresh}
      className={`news ${className ?? ""}`}
    >
      {!feed.data?.length ? (
        <Empty error={feed.error} loading={feed.loading} />
      ) : (
        <ol className="news-list">
          {feed.data.map((it) => {
            const fresh = it.date && now - it.date.getTime() < NEW_MS;
            return (
              <li key={it.link || it.title}>
                <time>{timeLabel(it.date, now)}</time>
                <a href={it.link} target="_blank" rel="noreferrer" title={it.title}>
                  {fresh && <span className="badge-new">NEW</span>}
                  {it.title}
                </a>
                <span className="src">{it.source}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
