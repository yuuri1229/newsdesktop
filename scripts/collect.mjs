// GitHub Actions 上で実行し、CORS 非対応のニュース RSS を取得して JSON に書き出す。
// 使い方: node scripts/collect.mjs <出力ディレクトリ>
// 出力ディレクトリには前回の結果が入っている前提で、取得に失敗した項目は前回値を残す。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = process.argv[2] || "data-out";
const UA = "Mozilla/5.0 (compatible; newsdesktop-collector/1.0; +https://github.com/yuuri1229/newsdesktop)";

async function get(url, timeoutMs = 15000, headers = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
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

// ---- ライブ配信の状態確認 ----
// 設定した配信 (lib/streams.json) が配信中か確認し、オフラインなら同じチャンネルの配信中ライブを探す。
// 判定できなかった場合は status: "unknown" とし、画面側は設定どおりの配信を表示する。
const STREAMS = JSON.parse(await readFile(new URL("../lib/streams.json", import.meta.url), "utf8"));
const YT_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "accept-language": "ja,en;q=0.8",
  // EU 等の同意画面を回避
  cookie: "CONSENT=YES+1; SOCS=CAI",
};

const unescapeJson = (s) => {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
};

function parseWatch(html) {
  const status = html.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/)?.[1] ?? null;
  const videoId = html.match(/"videoDetails":\{"videoId":"([\w-]{11})"/)?.[1] ?? null;
  const channelId =
    html.match(/"videoDetails":\{[^}]*?"channelId":"(UC[\w-]{22})"/)?.[1] ??
    html.match(/<meta itemprop="channelId" content="(UC[\w-]{22})"/)?.[1] ??
    html.match(/"externalChannelId":"(UC[\w-]{22})"/)?.[1] ??
    null;
  const rawTitle = html.match(/"videoDetails":\{[^}]*?"title":"((?:[^"\\]|\\.)*)"/)?.[1];
  const rawAuthor = html.match(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/)?.[1] ?? html.match(/"author":"((?:[^"\\]|\\.)*)"/)?.[1];
  const isLiveNow = /"isLiveNow":true/.test(html) || /"videoDetails":\{[^}]*?"isLive":true/.test(html);
  return {
    status,
    videoId,
    channelId,
    title: rawTitle ? unescapeJson(rawTitle) : null,
    channel: rawAuthor ? unescapeJson(rawAuthor) : null,
    isLiveNow,
  };
}

async function checkStream(s) {
  const base = { id: s.id, title: s.title, group: s.group, checkedAt: new Date().toISOString() };
  const w = parseWatch(await get(`https://www.youtube.com/watch?v=${s.id}`, 15000, YT_HEADERS));
  // ボット確認などでページが取れていない場合は判定不能
  if (!w.status || w.status === "LOGIN_REQUIRED") return { ...base, status: "unknown", activeId: s.id, reason: w.status ?? "parse" };
  if (w.status === "OK" && w.isLiveNow) {
    return { ...base, status: "live", activeId: s.id, channelId: w.channelId, channel: w.channel, activeTitle: w.title };
  }
  if (!w.channelId) return { ...base, status: "offline", activeId: null, channel: w.channel };

  // 同じチャンネルで配信中のライブ (/channel/<id>/live は配信中なら視聴ページを返す)
  const live = parseWatch(await get(`https://www.youtube.com/channel/${w.channelId}/live`, 15000, YT_HEADERS));
  if (live.videoId && live.isLiveNow && live.status === "OK") {
    return {
      ...base,
      status: live.videoId === s.id ? "live" : "replaced",
      activeId: live.videoId,
      channelId: w.channelId,
      channel: w.channel ?? live.channel,
      activeTitle: live.title,
    };
  }
  return { ...base, status: "offline", activeId: null, channelId: w.channelId, channel: w.channel };
}

await save("live-streams.json", async () => {
  const results = [];
  for (const s of STREAMS) {
    try {
      const r = await checkStream(s);
      console.log(`live: ${s.title} -> ${r.status} ${r.activeId ?? ""} ${r.reason ?? ""}`);
      results.push(r);
    } catch (e) {
      console.warn(`live: ${s.title} failed:`, e.message);
      results.push({ id: s.id, title: s.title, group: s.group, status: "unknown", activeId: s.id, checkedAt: new Date().toISOString() });
    }
  }
  return results;
});
