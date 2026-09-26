import { fetchViaProxy } from "./fetcher";

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

const gnews = (path: string) => `https://news.google.com/rss/${path}hl=ja&gl=JP&ceid=JP:ja`;
const nhk = (cat: string) => `https://www3.nhk.or.jp/rss/news/${cat}.xml`;

export const FEEDS = {
  domestic: [
    { name: "NHK", url: nhk("cat0") },
    { name: "NHK", url: nhk("cat1") },
    { name: "NHK", url: nhk("cat4") },
    { name: "Google News", url: gnews("headlines/section/topic/NATION?") },
  ],
  world: [
    { name: "NHK", url: nhk("cat6") },
    { name: "Google News", url: gnews("headlines/section/topic/WORLD?") },
  ],
  local: (pref: string, city: string): FeedSource[] => {
    const q = (s: string) => gnews(`search?q=${encodeURIComponent(`${s} when:1d`)}&`);
    const list: FeedSource[] = [];
    if (city) list.push({ name: "Google News", url: q(city) });
    if (pref && pref !== city) list.push({ name: "Google News", url: q(pref) });
    return list;
  },
};
