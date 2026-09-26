"use client";

// 端末時計と日本標準時 (NICT) のずれを NTP と同じ考え方で推定する。
//   送信時刻 t0 / 受信時刻 t1 (端末の単調時計) とサーバー時刻 S から
//   offset = S - (t0 + t1) / 2, 往復遅延 RTT = t1 - t0, 誤差上限 = RTT / 2 + サーバー時刻の分解能
// 直近のサンプルのうち RTT 最小のものを採用し (NTP の clock filter)、
// サンプル間のばらつき (RMS) をジッターとして表示する。

import { useEffect, useRef, useState } from "react";

export type SyncSource = "NICT" | "Akamai" | "HTTP Date";

type Sample = { offset: number; rtt: number; resolution: number; source: SyncSource; at: number };

export type TimeSync = {
  status: "syncing" | "synced" | "failed";
  source: SyncSource | null;
  /** 補正量: 正しい時刻 = 単調時計 (timeOrigin + performance.now()) + offset [ms] */
  offset: number;
  /** 端末の時計 (Date.now()) が正しい時刻よりどれだけ進んでいるか [ms] */
  deviceDrift: number;
  /** 表示時刻の誤差上限 ± [ms] */
  accuracy: number;
  rtt: number;
  jitter: number;
  samples: number;
  lastSync: number | null;
};

const mono = () => performance.timeOrigin + performance.now();
const WINDOW = 8;
const INITIAL_SAMPLES = 4;
const INTERVAL_MS = 60_000;

// ---- 時刻ソース ----

/** NICT の JSONP サービス。レスポンスは jsont({... "st": サーバー時刻(秒) ...}) */
function nict(timeoutMs = 5000): Promise<Sample> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { jsont?: (d: { st: number }) => void };
    const script = document.createElement("script");
    const cleanup = () => {
      clearTimeout(timer);
      delete w.jsont;
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("NICT timeout"));
    }, timeoutMs);
    let t0 = 0;
    w.jsont = (d) => {
      const t1 = mono();
      cleanup();
      if (typeof d?.st !== "number") return reject(new Error("NICT bad response"));
      resolve({ offset: d.st * 1000 - (t0 + t1) / 2, rtt: t1 - t0, resolution: 1, source: "NICT", at: t1 });
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("NICT load error"));
    };
    t0 = mono();
    script.src = `https://ntp-a1.nict.go.jp/cgi-bin/jsont?${(Date.now() / 1000).toFixed(3)}`;
    document.head.appendChild(script);
  });
}

async function timed(url: string, init?: RequestInit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const t0 = mono();
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal, ...init });
    const t1 = mono();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { res, t0, t1 };
  } finally {
    clearTimeout(timer);
  }
}

/** Akamai の時刻サービス (ミリ秒精度、CORS 対応) */
async function akamai(): Promise<Sample> {
  const { res, t0, t1 } = await timed(`https://time.akamai.com/?ms&_=${Date.now()}`);
  const s = parseFloat(await res.text());
  if (!isFinite(s)) throw new Error("Akamai bad response");
  return { offset: s * 1000 - (t0 + t1) / 2, rtt: t1 - t0, resolution: 1, source: "Akamai", at: t1 };
}

/** 最終手段: 配信元サーバーの Date ヘッダー (1 秒単位なので ±0.5 秒) */
async function httpDate(): Promise<Sample> {
  const { res, t0, t1 } = await timed(`${location.pathname}?_=${Date.now()}`, { method: "HEAD" });
  const d = Date.parse(res.headers.get("date") ?? "");
  if (isNaN(d)) throw new Error("no Date header");
  return { offset: d + 500 - (t0 + t1) / 2, rtt: t1 - t0, resolution: 500, source: "HTTP Date", at: t1 };
}

async function sample(preferred: SyncSource | null): Promise<Sample> {
  const all: [SyncSource, () => Promise<Sample>][] = [
    ["NICT", nict],
    ["Akamai", akamai],
    ["HTTP Date", httpDate],
  ];
  // 一度成功したソースから試す
  const order = preferred ? [...all.filter(([n]) => n === preferred), ...all.filter(([n]) => n !== preferred)] : all;
  let err: unknown;
  for (const [, fn] of order) {
    try {
      return await fn();
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

function summarize(samples: Sample[]): Omit<TimeSync, "status" | "lastSync"> {
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  const same = samples.filter((s) => s.source === best.source);
  const jitter =
    same.length > 1 ? Math.sqrt(same.reduce((sum, s) => sum + (s.offset - best.offset) ** 2, 0) / (same.length - 1)) : 0;
  return {
    source: best.source,
    offset: best.offset,
    deviceDrift: Date.now() - (mono() + best.offset),
    accuracy: best.rtt / 2 + best.resolution,
    rtt: best.rtt,
    jitter,
    samples: samples.length,
  };
}

const INITIAL: TimeSync = {
  status: "syncing",
  source: null,
  offset: 0,
  deviceDrift: 0,
  accuracy: Infinity,
  rtt: 0,
  jitter: 0,
  samples: 0,
  lastSync: null,
};

export function useTimeSync(): TimeSync {
  const [state, setState] = useState<TimeSync>(INITIAL);
  const samples = useRef<Sample[]>([]);

  useEffect(() => {
    let cancelled = false;
    let busy = false;

    const take = async (n: number) => {
      if (busy) return;
      busy = true;
      try {
        for (let i = 0; i < n && !cancelled; i++) {
          try {
            const s = await sample(samples.current.at(-1)?.source ?? null);
            samples.current = [...samples.current, s].slice(-WINDOW);
            if (!cancelled) setState({ status: "synced", lastSync: Date.now(), ...summarize(samples.current) });
          } catch {
            if (!cancelled && !samples.current.length) setState((p) => ({ ...p, status: "failed" }));
          }
          if (i < n - 1) await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        busy = false;
      }
    };

    take(INITIAL_SAMPLES);
    const id = setInterval(() => take(1), INTERVAL_MS);
    // スリープ復帰などで単調時計が止まっていた可能性があるので取り直す
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        samples.current = [];
        take(INITIAL_SAMPLES);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return state;
}

/**
 * 補正済みの現在時刻を、秒の切り替わりに合わせて更新する。
 * lag はタイマーが予定時刻からどれだけ遅れて描画に入ったか (表示遅延) の移動平均 [ms]。
 */
export function useCorrectedClock(offset: number): { now: Date | null; lag: number } {
  const [state, setState] = useState<{ now: Date | null; lag: number }>({ now: null, lag: 0 });
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let lagAvg = 0;
    const tick = (target: number | null) => {
      const t = mono() + offsetRef.current;
      if (target != null) lagAvg = lagAvg ? lagAvg * 0.8 + (t - target) * 0.2 : t - target;
      setState({ now: new Date(t), lag: Math.max(0, lagAvg) });
      const next = Math.floor(t / 1000) * 1000 + 1000;
      timer = setTimeout(() => tick(next), next - t);
    };
    tick(null);
    return () => clearTimeout(timer);
  }, []);

  return state;
}
