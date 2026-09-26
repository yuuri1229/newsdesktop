import { fetchViaProxy } from "./fetcher";

export type Quote = {
  name: string;
  price: number;
  prevClose: number | null;
  time: Date | null;
  points: { t: number; v: number }[];
  source: string;
};

type YahooChart = {
  chart: {
    result: {
      meta: { regularMarketPrice: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators: { quote: { close: (number | null)[] }[] };
    }[] | null;
  };
};

async function fromYahoo(symbol: string, name: string): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`;
  const json = JSON.parse(await fetchViaProxy(url)) as YahooChart;
  const r = json.chart.result?.[0];
  if (!r || typeof r.meta.regularMarketPrice !== "number") throw new Error("no data");
  const closes = r.indicators.quote[0]?.close ?? [];
  const points = (r.timestamp ?? [])
    .map((t, i) => ({ t: t * 1000, v: closes[i] }))
    .filter((p): p is { t: number; v: number } => typeof p.v === "number");
  return {
    name,
    price: r.meta.regularMarketPrice,
    prevClose: r.meta.chartPreviousClose ?? r.meta.previousClose ?? null,
    time: r.meta.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000) : null,
    points,
    source: "Yahoo Finance",
  };
}

// stooq の日足 CSV (Date,Open,High,Low,Close,Volume) から直近 2 本を使う
async function fromStooq(symbol: string, name: string): Promise<Quote> {
  const csv = await fetchViaProxy(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`);
  const rows = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
  const last = rows.at(-1);
  const prev = rows.at(-2);
  const price = last ? Number(last[4]) : NaN;
  if (!last || isNaN(price)) throw new Error("no data");
  return {
    name,
    price,
    prevClose: prev ? Number(prev[4]) : null,
    time: new Date(`${last[0]}T15:30:00+09:00`),
    points: rows.slice(-30).map((r) => ({ t: new Date(r[0]).getTime(), v: Number(r[4]) })),
    source: "stooq (日足)",
  };
}

async function firstOk(tasks: (() => Promise<Quote>)[]): Promise<Quote> {
  let err: unknown;
  for (const t of tasks) {
    try {
      return await t();
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

export async function fetchMarkets(): Promise<Quote[]> {
  const [nikkei, topix] = await Promise.allSettled([
    firstOk([() => fromYahoo("^N225", "日経平均株価"), () => fromStooq("^nkx", "日経平均株価")]),
    firstOk([
      () => fromYahoo("^TOPX", "TOPIX"),
      () => fromYahoo("998405.T", "TOPIX"),
      () => fromStooq("^tpx", "TOPIX"),
    ]),
  ]);
  if (nikkei.status === "rejected" && topix.status === "rejected") throw nikkei.reason;
  return [nikkei, topix].map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { name: i === 0 ? "日経平均株価" : "TOPIX", price: NaN, prevClose: null, time: null, points: [], source: "取得失敗" },
  );
}

/** 東証の立会状況 (前場 9:00-11:30 / 後場 12:30-15:30、土日) */
export function tseSession(now: Date): { label: string; open: boolean } {
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const day = jst.getDay();
  if (day === 0 || day === 6) return { label: "休場", open: false };
  const m = jst.getHours() * 60 + jst.getMinutes();
  if (m < 9 * 60) return { label: "取引前", open: false };
  if (m < 11 * 60 + 30) return { label: "前場 取引中", open: true };
  if (m < 12 * 60 + 30) return { label: "昼休み", open: false };
  if (m < 15 * 60 + 30) return { label: "後場 取引中", open: true };
  return { label: "取引終了", open: false };
}
