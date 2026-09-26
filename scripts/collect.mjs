// GitHub Actions 上で実行し、CORS 非対応のニュース RSS を取得して JSON に書き出す。
// 使い方: node scripts/collect.mjs <出力ディレクトリ>
// 出力ディレクトリには前回の結果が入っている前提で、取得に失敗した項目は前回値を残す。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = process.argv[2] || "data-out";
const UA = "Mozilla/5.0 (compatible; newsdesktop-collector/1.0; +https://github.com/yuuri1229/newsdesktop)";

async function get(url, timeoutMs = 15000) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

// ---- RSS ----
const decode = (s) =>
  s
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

function parseRss(xml, fallbackSource) {
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].map(([item]) => {
    let title = tag(item, "title");
    const source = tag(item, "source");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    // Yahoo!ニュースはタイトル末尾に "(配信元)" が付く
    const media = !source && title.match(/\(([^()]+)\)$/);
    if (media) title = title.slice(0, media.index).trim();
    const d = new Date(tag(item, "pubDate"));
    return {
      title,
      link: tag(item, "link"),
      date: isNaN(d.getTime()) ? null : d.toISOString(),
      source: source || (media ? media[1] : fallbackSource),
    };
  });
}

async function feeds(sources, limit = 40) {
  const results = await Promise.allSettled(sources.map(async (s) => parseRss(await get(s.url), s.name)));
  results.forEach((r, i) => r.status === "rejected" && console.warn("feed failed:", sources[i].url, r.reason.message));
  const ok = results.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
  if (!ok.length) throw new Error("all feeds failed");
  const seen = new Set();
  return ok
    .filter((it) => {
      const k = it.title.replace(/\s+/g, "");
      if (!it.title || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, limit);
}

const yahoo_ = (p) => `https://news.yahoo.co.jp/rss/${p}.xml`;
const YAHOO = "Yahoo!ニュース";

// ---- 書き出し ----
async function save(file, fn) {
  const p = path.join(OUT, file);
  try {
    const data = await fn();
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({ updatedAt: new Date().toISOString(), data }));
    console.log("ok  ", file);
    return true;
  } catch (e) {
    console.warn("fail", file, e.message);
    return false;
  }
}

await mkdir(OUT, { recursive: true });

await Promise.all([
  save("news-domestic.json", () =>
    feeds([
      { name: YAHOO, url: yahoo_("topics/domestic") },
      { name: YAHOO, url: yahoo_("categories/domestic") },
      { name: YAHOO, url: yahoo_("topics/business") },
    ]),
  ),
  // 主要トピックス (速報通知・テロップ用)
  save("news-top.json", () => feeds([{ name: YAHOO, url: yahoo_("topics/top-picks") }], 20)),
  save("news-world.json", () =>
    feeds([
      { name: YAHOO, url: yahoo_("topics/world") },
      { name: YAHOO, url: yahoo_("categories/world") },
    ]),
  ),
]);
