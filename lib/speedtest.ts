"use client";

import { useCallback, useEffect, useState } from "react";
import type { EngineResult, LiveProgress, TestMode } from "./speedtest-engine";

export type { LiveProgress, TestMode } from "./speedtest-engine";

export const AUTO_INTERVAL_MS = 30 * 60 * 1000;

// ---- 記録 ----

export type SpeedRecord = {
  /** 計測開始時刻 (epoch ms) */
  t: number;
  trigger: "auto" | "manual";
  mode: TestMode;
  down: number | null;
  up: number | null;
  ping: number | null;
  jitter: number | null;
  downLoaded: number | null;
  upLoaded: number | null;
  bytes: number;
  dur: number;
  /** 接続先の Cloudflare データセンター / プロバイダー (取得できた場合) */
  colo?: string;
  isp?: string;
  error?: string;
};

export type SpeedSettings = {
  auto: boolean;
  mode: TestMode;
  /** 次の自動計測の予定時刻 */
  nextAt: number | null;
};

export const MODE_LABELS: Record<TestMode, { name: string; note: string }> = {
  light: { name: "軽量", note: "1 回あたり最大 約 120MB。回線が速いと実際より低めに出ることがあります" },
  standard: { name: "標準", note: "1 回あたり最大 約 320MB。一般的な光回線まで正確に測れます" },
  precise: { name: "高精度", note: "1 回あたり最大 約 1GB。1Gbps 超の回線向け (speed.cloudflare.com と同等)" },
};

const HISTORY_KEY = "newsdesktop:speedtest:history";
const SETTINGS_KEY = "newsdesktop:speedtest:settings";
const MAX_RECORDS = 4000; // 30 分ごとで約 83 日分

const DEFAULT_SETTINGS: SpeedSettings = { auto: false, mode: "standard", nextAt: null };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export const readHistory = () => read<SpeedRecord[]>(HISTORY_KEY, []);
export const readSettings = () => ({ ...DEFAULT_SETTINGS, ...read<Partial<SpeedSettings>>(SETTINGS_KEY, {}) });

/** 履歴と設定。localStorage に保存し、他のタブとも同期する。 */
export function useSpeedStore() {
  const [history, setHistory] = useState<SpeedRecord[]>([]);
  const [settings, setSettings] = useState<SpeedSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setHistory(readHistory());
    setSettings(readSettings());
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === HISTORY_KEY) setHistory(readHistory());
      if (e.key === SETTINGS_KEY) setSettings(readSettings());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addRecord = useCallback((rec: SpeedRecord) => {
    const next = [...readHistory(), rec].sort((a, b) => a.t - b.t).slice(-MAX_RECORDS);
    write(HISTORY_KEY, next);
    setHistory(next);
  }, []);

  const clearHistory = useCallback(() => {
    write(HISTORY_KEY, []);
    setHistory([]);
  }, []);

  const updateSettings = useCallback((patch: Partial<SpeedSettings>) => {
    const next = { ...readSettings(), ...patch };
    write(SETTINGS_KEY, next);
    setSettings(next);
  }, []);

  return { history, settings, ready, addRecord, clearHistory, updateSettings };
}

/** デスクトップのヘッダーに出す最新結果 */
export function useLatestSpeed(): SpeedRecord | null {
  const [latest, setLatest] = useState<SpeedRecord | null>(null);
  useEffect(() => {
    const load = () => setLatest([...readHistory()].reverse().find((r) => !r.error) ?? null);
    load();
    const onStorage = (e: StorageEvent) => e.key === HISTORY_KEY && load();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return latest;
}

// ---- 実行 ----

export type RunningTest = { promise: Promise<EngineResult>; abort: () => void };

/** Worker で計測する (作れない環境ではメインスレッドで実行) */
export function startSpeedTest(mode: TestMode, onProgress: (p: LiveProgress) => void): RunningTest {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./speedtest.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }

  if (!worker) {
    const ctrl = new AbortController();
    const promise = import("./speedtest-engine").then((m) => m.runSpeedTest(mode, onProgress, ctrl.signal));
    return { promise, abort: () => ctrl.abort() };
  }

  const w = worker;
  let settle: { resolve: (r: EngineResult) => void; reject: (e: Error) => void } | null = null;
  const promise = new Promise<EngineResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const finish = () => w.terminate();
  w.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    if (msg.type === "progress") onProgress(msg.progress);
    else if (msg.type === "done") {
      finish();
      settle?.resolve(msg.result);
    } else if (msg.type === "error") {
      finish();
      settle?.reject(msg.aborted ? new DOMException("aborted", "AbortError") : new Error(msg.message));
    }
  };
  w.onerror = (e) => {
    finish();
    settle?.reject(new Error(e.message || "Worker error"));
  };
  w.postMessage({ type: "start", mode });
  return {
    promise,
    abort: () => {
      finish();
      settle?.reject(new DOMException("aborted", "AbortError"));
    },
  };
}

type Meta = { colo?: string; city?: string; asOrganization?: string };

/** 接続先データセンターとプロバイダー名 (取得できなければ空) */
export async function fetchMeta(): Promise<{ colo?: string; isp?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch("https://speed.cloudflare.com/meta", { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return {};
    const m = (await res.json()) as Meta;
    return {
      colo: [m.colo, m.city].filter(Boolean).join(" ") || undefined,
      isp: m.asOrganization || undefined,
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

// ---- 評価 ----

export type MetricKey = "down" | "up" | "ping" | "jitter" | "bloat";

type MetricDef = {
  label: string;
  desc: string;
  unit: "Mbps" | "ms";
  /** 大きいほど良い */
  higher: boolean;
  /** S / A / B / C / D の境界 */
  steps: [number, number, number, number, number];
  weight: number;
};

export const METRICS: Record<MetricKey, MetricDef> = {
  down: { label: "下り", desc: "ダウンロード速度", unit: "Mbps", higher: true, steps: [500, 100, 30, 10, 3], weight: 0.3 },
  up: { label: "上り", desc: "アップロード速度", unit: "Mbps", higher: true, steps: [300, 50, 10, 3, 1], weight: 0.2 },
  ping: { label: "Ping", desc: "無負荷時の応答時間", unit: "ms", higher: false, steps: [10, 20, 50, 100, 200], weight: 0.2 },
  jitter: { label: "ジッター", desc: "Ping のばらつき", unit: "ms", higher: false, steps: [2, 5, 15, 30, 60], weight: 0.15 },
  bloat: { label: "負荷時の遅延増加", desc: "通信中に Ping がどれだけ悪化するか", unit: "ms", higher: false, steps: [10, 30, 60, 150, 400], weight: 0.15 },
};
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export function metricValue(r: SpeedRecord, key: MetricKey): number | null {
  if (key !== "bloat") return r[key];
  const loaded = Math.max(r.downLoaded ?? -Infinity, r.upLoaded ?? -Infinity);
  if (r.ping === null || !Number.isFinite(loaded)) return null;
  return Math.max(0, loaded - r.ping);
}

export type Grade = "S" | "A" | "B" | "C" | "D";
export const GRADES: Grade[] = ["S", "A", "B", "C", "D"];
export const GRADE_LABELS: Record<Grade, string> = { S: "非常に良い", A: "良い", B: "普通", C: "やや悪い", D: "悪い" };

/** 0〜100 点。境界値で S=100 / A=80 / B=60 / C=40 / D=20、その間は対数で補間 */
export function metricScore(key: MetricKey, v: number): number {
  const { higher, steps } = METRICS[key];
  const f = (x: number) => (higher ? 1 : -1) * Math.log(Math.max(x, 0.01));
  const knots = [...steps, (steps[4] * steps[4]) / steps[3]].map((s, i) => [f(s), 100 - 20 * i] as const);
  const x = f(v);
  if (x >= knots[0][0]) return 100;
  for (let i = 0; i < knots.length - 1; i++) {
    const [x0, s0] = knots[i];
    const [x1, s1] = knots[i + 1];
    if (x >= x1) return s1 + ((x - x1) / (x0 - x1)) * (s0 - s1);
  }
  return 0;
}

export function metricGrade(key: MetricKey, v: number): Grade {
  const { higher, steps } = METRICS[key];
  const i = steps.findIndex((s) => (higher ? v >= s : v <= s));
  return GRADES[i === -1 ? 4 : i];
}

export function overallScore(r: SpeedRecord): number | null {
  let sum = 0;
  let w = 0;
  for (const k of METRIC_KEYS) {
    const v = metricValue(r, k);
    if (v === null) continue;
    sum += metricScore(k, v) * METRICS[k].weight;
    w += METRICS[k].weight;
  }
  return w >= 0.5 ? sum / w : null;
}

export function scoreGrade(score: number): Grade {
  return score >= 90 ? "S" : score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "D";
}

export const GRADE_COMMENTS: Record<Grade, string> = {
  S: "非常に高速で安定した回線です。あらゆる用途で快適に使えます。",
  A: "高速な回線です。ほとんどの用途で快適に使えます。",
  B: "一般的な用途には十分です。大容量の通信や対戦ゲームでは物足りない場面があります。",
  C: "やや遅い回線です。高画質の動画やビデオ会議が不安定になることがあります。",
  D: "遅い回線です。Web 閲覧以外では支障が出る可能性があります。",
};

// ---- 用途別の評価 ----

type Cond = [MetricKey, number];
type UseCase = { name: string; tiers: [Cond[], Cond[], Cond[]] };

export const USE_CASES: UseCase[] = [
  { name: "Web・SNS", tiers: [[["down", 10], ["ping", 50]], [["down", 3], ["ping", 100]], [["down", 1]]] },
  { name: "HD 動画 (1080p)", tiers: [[["down", 15]], [["down", 5]], [["down", 3]]] },
  { name: "4K 動画", tiers: [[["down", 50]], [["down", 25]], [["down", 15]]] },
  {
    name: "ビデオ会議",
    tiers: [
      [["down", 10], ["up", 10], ["ping", 50], ["jitter", 10]],
      [["down", 3], ["up", 3], ["ping", 100], ["jitter", 30]],
      [["down", 1], ["up", 1], ["ping", 200]],
    ],
  },
  {
    name: "オンラインゲーム",
    tiers: [
      [["ping", 20], ["jitter", 5], ["bloat", 30]],
      [["ping", 50], ["jitter", 15], ["bloat", 100]],
      [["ping", 100], ["jitter", 30]],
    ],
  },
  { name: "ライブ配信 (配信側)", tiers: [[["up", 30], ["jitter", 10]], [["up", 10], ["jitter", 20]], [["up", 5]]] },
  { name: "大容量ダウンロード", tiers: [[["down", 300]], [["down", 100]], [["down", 30]]] },
  { name: "クラウドバックアップ", tiers: [[["up", 100]], [["up", 30]], [["up", 10]]] },
];

export const SUIT_LABELS = [
  { mark: "◎", text: "快適" },
  { mark: "○", text: "問題なし" },
  { mark: "△", text: "最低限" },
  { mark: "×", text: "難しい" },
] as const;

/** 0 = ◎ … 3 = × 。計測できなかった項目の条件は無視する */
export function suitability(uc: UseCase, r: SpeedRecord): number {
  const ok = (conds: Cond[]) =>
    conds.every(([k, th]) => {
      const v = metricValue(r, k);
      if (v === null) return true;
      return METRICS[k].higher ? v >= th : v <= th;
    });
  const i = uc.tiers.findIndex(ok);
  return i === -1 ? 3 : i;
}

export const condText = (conds: Cond[]) =>
  conds.map(([k, th]) => `${METRICS[k].label} ${th}${METRICS[k].unit === "Mbps" ? " Mbps 以上" : " ms 以下"}`).join("・");

// ---- 期間の統計 ----

export type Stats = { n: number; avg: number; median: number; min: number; max: number; sd: number; cv: number };

export function stats(values: number[]): Stats | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const avg = s.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - avg) ** 2, 0) / n);
  return {
    n,
    avg,
    median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2,
    min: s[0],
    max: s[n - 1],
    sd,
    cv: avg > 0 ? sd / avg : 0,
  };
}

// 遅延系は値が小さく変動係数だと大げさになるので、標準偏差 (ms) で判定する
const SD_LIMITS: Partial<Record<MetricKey, [number, number]>> = { ping: [3, 10], jitter: [2, 5], bloat: [15, 40] };

export function stability(key: MetricKey | "score", st: Stats): { text: string; level: "good" | "warn" | "bad" } {
  const lim = key === "score" ? undefined : SD_LIMITS[key];
  const [v, a, b] = lim ? [st.sd, lim[0], lim[1]] : [st.cv, 0.1, 0.25];
  if (v < a) return { text: "安定", level: "good" };
  if (v < b) return { text: "やや変動あり", level: "warn" };
  return { text: "不安定", level: "bad" };
}

/** 時間帯 (0〜23 時) 別の平均 */
export function hourlyAverage(records: SpeedRecord[], key: MetricKey): (number | null)[] {
  const sum = Array(24).fill(0);
  const cnt = Array(24).fill(0);
  for (const r of records) {
    const v = metricValue(r, key);
    if (v === null) continue;
    const h = new Date(r.t).getHours();
    sum[h] += v;
    cnt[h]++;
  }
  return sum.map((s, h) => (cnt[h] ? s / cnt[h] : null));
}

// ---- 表示 ----

export function fmtValue(v: number | null | undefined, unit: "Mbps" | "ms" | "score"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (unit === "score") return v.toFixed(0);
  if (unit === "ms") return v < 10 ? v.toFixed(1) : v.toFixed(0);
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

export function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}

export function toCsv(records: SpeedRecord[]): string {
  const head = ["日時", "種別", "モード", "下り(Mbps)", "上り(Mbps)", "Ping(ms)", "ジッター(ms)", "下り負荷時Ping(ms)", "上り負荷時Ping(ms)", "スコア", "データ量(MB)", "所要(秒)", "接続先", "プロバイダー", "エラー"];
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const r2 = (v: number | null) => (v === null ? "" : Math.round(v * 100) / 100);
  const rows = records.map((r) => {
    const score = overallScore(r);
    return [
      new Date(r.t).toLocaleString("ja-JP"),
      r.trigger === "auto" ? "自動" : "手動",
      MODE_LABELS[r.mode]?.name ?? r.mode,
      r2(r.down),
      r2(r.up),
      r2(r.ping),
      r2(r.jitter),
      r2(r.downLoaded),
      r2(r.upLoaded),
      score === null ? "" : Math.round(score),
      (r.bytes / 1e6).toFixed(1),
      (r.dur / 1000).toFixed(1),
      r.colo,
      r.isp,
      r.error,
    ]
      .map(cell)
      .join(",");
  });
  return "﻿" + [head.join(","), ...rows].join("\n");
}
