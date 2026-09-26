// GitHub Actions 上で実行し、CORS 非対応のニュース/株価を取得して JSON に書き出す。
// 使い方: node scripts/collect.mjs <出力ディレクトリ>
// 出力ディレクトリには前回の結果が入っている前提で、取得に失敗した項目は前回値を残す。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = process.argv[2] || "data-out";
const PREFS = JSON.parse(await readFile(new URL("../lib/prefectures.json", import.meta.url), "utf8"));
const UA = "Mozilla/5.0 (compatible; newsdesktop-collector/1.0; +https://github.com/yuuri1229/newsdesktop)";
const LOCAL_MAX_AGE_MS = 20 * 60 * 1000;

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
    const d = new Date(tag(item, "pubDate"));
    return {
      title,
      link: tag(item, "link"),
      date: isNaN(d.getTime()) ? null : d.toISOString(),
      source: source || fallbackSource,
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

const gnews = (p) => `https://news.google.com/rss/${p}hl=ja&gl=JP&ceid=JP:ja`;
const nhk = (c) => `https://www3.nhk.or.jp/rss/news/${c}.xml`;
const gsearch = (q) => gnews(`search?q=${encodeURIComponent(`${q} when:1d`)}&`);

// ---- 株価 ----
async function yahoo(symbol, name) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`;
  const r = JSON.parse(await get(url)).chart?.result?.[0];
  if (!r || typeof r.meta?.regularMarketPrice !== "number") throw new Error(`no data ${symbol}`);
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  return {
    name,
    price: r.meta.regularMarketPrice,
    prevClose: r.meta.chartPreviousClose ?? r.meta.previousClose ?? null,
    time: r.meta.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000).toISOString() : null,
    points: (r.timestamp ?? []).map((t, i) => ({ t: t * 1000, v: closes[i] })).filter((p) => typeof p.v === "number"),
    source: "Yahoo Finance",
  };
}

async function stooq(symbol, name) {
  const rows = (await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`))
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(","))
    .filter((r) => r.length >= 5 && !isNaN(Number(r[4])));
  const last = rows.at(-1);
  if (!last) throw new Error(`no data ${symbol}`);
  return {
    name,
    price: Number(last[4]),
    prevClose: rows.length > 1 ? Number(rows.at(-2)[4]) : null,
    time: new Date(`${last[0]}T15:30:00+09:00`).toISOString(),
    points: rows.slice(-30).map((r) => ({ t: new Date(r[0]).getTime(), v: Number(r[4]) })),
    source: "stooq (日足)",
  };
}

const toNum = (v) => (v == null ? NaN : Number(String(v).replace(/,/g, "")));

// 1 回の取得で現在値しか取れないソースは、前回ファイルの当日分の点に追記してチャートを作る
let previousMarket = [];
try {
  previousMarket = JSON.parse(await readFile(path.join(OUT, "market.json"), "utf8")).data ?? [];
} catch {}
const jstDate = (t) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
const inSession = (t) => {
  const d = new Date(t + 9 * 3600e3);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return d.getUTCDay() % 6 !== 0 && m >= 9 * 60 && m <= 15 * 60 + 35;
};
/** 取引時間中は当日の点に追記、時間外は直近の立会の点と時刻をそのまま使う */
function withHistory(name, price) {
  const now = Date.now();
  const prev = previousMarket.find((q) => q.name === name);
  const prevPoints = prev?.points ?? [];
  if (!inSession(now) && prevPoints.length) return { points: prevPoints, time: prev.time ?? null };
  const today = prevPoints.filter((p) => jstDate(p.t) === jstDate(now));
  return { points: [...today, { t: now, v: price }].slice(-120), time: new Date(now).toISOString() };
}

async function googleFinance(ticker, name) {
  const html = await get(`https://www.google.com/finance/quote/${ticker}?hl=en`);
  const price = toNum(html.match(/data-last-price="([\d.,]+)"/)?.[1]);
  if (isNaN(price)) throw new Error(`google: no price ${ticker}`);
  const prevClose = toNum(html.match(/Previous close<\/div>[\s\S]{0,400}?>([\d,]+\.\d+)</)?.[1]);
  const ts = Number(html.match(/data-last-normal-market-timestamp="(\d+)"/)?.[1]);
  return {
    name,
    price,
    prevClose: isNaN(prevClose) ? null : prevClose,
    ...withHistory(name, price),
    ...(ts ? { time: new Date(ts * 1000).toISOString() } : {}),
    source: "Google Finance",
  };
}

async function yahooJapan(code, name) {
  const html = await get(`https://finance.yahoo.co.jp/quote/${code}`);
  const board = html.match(/"mainIndicatorPriceBoard"\s*:\s*\{[\s\S]{0,2000}?\}/)?.[0] ?? html;
  const price = toNum(board.match(/"price"\s*:\s*"([\d,.]+)"/)?.[1]);
  if (isNaN(price)) throw new Error(`yahoo.co.jp: no price ${code}`);
  const change = toNum(board.match(/"changePrice"\s*:\s*"([+\-\d,.]+)"/)?.[1]);
  return {
    name,
    price,
    prevClose: isNaN(change) ? null : Math.round((price - change) * 100) / 100,
    ...withHistory(name, price),
    source: "Yahoo!ファイナンス",
  };
}

async function firstOk(name, tasks) {
  for (const t of tasks) {
    try {
      const q = await t();
      console.log(`${name}: ${q.price} (${q.source})`);
      return q;
    } catch (e) {
      console.warn(`${name}:`, e.message);
    }
  }
  throw new Error(`${name} failed`);
}

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

async function isStale(file) {
  try {
    // git checkout で mtime は当てにならないため、JSON 内の updatedAt で判定する
    const { updatedAt } = JSON.parse(await readFile(path.join(OUT, file), "utf8"));
    return Date.now() - new Date(updatedAt).getTime() > LOCAL_MAX_AGE_MS;
  } catch {
    return true;
  }
}

await mkdir(OUT, { recursive: true });

await Promise.all([
  save("news-domestic.json", () =>
    feeds([
      { name: "NHK", url: nhk("cat0") },
      { name: "NHK", url: nhk("cat1") },
      { name: "NHK", url: nhk("cat4") },
      { name: "Google News", url: gnews("headlines/section/topic/NATION?") },
    ]),
  ),
  save("news-world.json", () =>
    feeds([
      { name: "NHK", url: nhk("cat6") },
      { name: "Google News", url: gnews("headlines/section/topic/WORLD?") },
    ]),
  ),
  save("market.json", async () => {
    const results = await Promise.allSettled([
      firstOk("N225", [() => yahoo("^N225", "日経平均株価"), () => stooq("^nkx", "日経平均株価")]),
      firstOk("TOPIX", [
        () => googleFinance("TOPIX:INDEXTOPIX", "TOPIX"),
        () => yahooJapan("998405.T", "TOPIX"),
        () => yahoo("^TOPX", "TOPIX"),
        () => stooq("^tpx", "TOPIX"),
      ]),
    ]);
    if (results.every((r) => r.status === "rejected")) throw new Error("market failed");
    return results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { name: i ? "TOPIX" : "日経平均株価", price: null, prevClose: null, time: null, points: [], source: "取得失敗" },
    );
  }),
]);

// 都道府県別の地域ニュース (Google News への負荷を抑えるため 20 分ごと・4 並列)
const targets = [];
for (const p of PREFS) if (await isStale(`local/${p.code}.json`)) targets.push(p);
for (let i = 0; i < targets.length; i += 4) {
  await Promise.all(
    targets.slice(i, i + 4).map((p) => save(`local/${p.code}.json`, () => feeds([{ name: "Google News", url: gsearch(p.name) }], 30))),
  );
}
