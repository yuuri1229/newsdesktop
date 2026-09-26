import { fetchViaProxy } from "./fetcher";
import { snapshotOr, type Snap } from "./snapshot";

export type NewsItem = {
  title: string;
  link: string;
  date: Date | null;
  source: string;
};

export type FeedSource = { name: string; url: string };

function text(el: Element, tag: string): string {
  return el.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
}

export function parseFeed(xml: string, fallbackSource: string): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("invalid feed");
  const nodes = [
    ...Array.from(doc.getElementsByTagName("item")),
    ...Array.from(doc.getElementsByTagName("entry")),
  ];
  return nodes.map((n) => {
    let title = text(n, "title");
    let source = text(n, "source") || fallbackSource;
    // Google News はタイトル末尾に " - 媒体名" が付く
    if (text(n, "source")) {
      const suffix = ` - ${text(n, "source")}`;
      if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
    }
    const linkEl = n.getElementsByTagName("link")[0];
    const link = linkEl?.getAttribute("href") || linkEl?.textContent?.trim() || "";
    const raw = text(n, "pubDate") || text(n, "published") || text(n, "updated") || text(n, "dc:date");
    const d = raw ? new Date(raw) : null;
    const media = !text(n, "source") && title.match(/\(([^()]+)\)$/);
    if (media) {
      title = title.slice(0, media.index).trim();
      source = media[1];
    }
    if (!source) source = fallbackSource;
    return { title, link, date: d && !isNaN(d.getTime()) ? d : null, source };
  });
}

/** 複数フィードを並列取得し、重複を除いて新しい順に並べる */
export async function fetchFeeds(sources: FeedSource[], limit = 40): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    sources.map(async (s) => parseFeed(await fetchViaProxy(s.url), s.name)),
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === "fulfilled");
  if (!ok.length) {
    const firstErr = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    throw firstErr?.reason ?? new Error("no feeds");
  }
  const seen = new Set<string>();
  return ok
    .flatMap((r) => r.value)
    .filter((it) => {
      const key = it.title.replace(/\s+/g, "");
      if (!it.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    .slice(0, limit);
}

const yahoo = (path: string) => `https://news.yahoo.co.jp/rss/${path}.xml`;
const YAHOO = "Yahoo!ニュース";

export const FEEDS = {
  domestic: [
    { name: YAHOO, url: yahoo("topics/domestic") },
    { name: YAHOO, url: yahoo("categories/domestic") },
    { name: YAHOO, url: yahoo("topics/business") },
  ],
  top: [{ name: YAHOO, url: yahoo("topics/top-picks") }],
  world: [
    { name: YAHOO, url: yahoo("topics/world") },
    { name: YAHOO, url: yahoo("categories/world") },
  ],
};

const reviveNews = (items: NewsItem[]) =>
  items.map((it) => ({ ...it, date: it.date ? new Date(it.date as unknown as string) : null }));

export const loadDomestic = (): Promise<Snap<NewsItem[]>> =>
  snapshotOr("news-domestic.json", () => fetchFeeds(FEEDS.domestic), reviveNews);

export const loadTop = (): Promise<Snap<NewsItem[]>> =>
  snapshotOr("news-top.json", () => fetchFeeds(FEEDS.top, 20), reviveNews);

export const loadWorld = (): Promise<Snap<NewsItem[]>> =>
  snapshotOr("news-world.json", () => fetchFeeds(FEEDS.world), reviveNews);
