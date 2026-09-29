// Cloudflare の計測エンジン (@cloudflare/speedtest = speed.cloudflare.com と同じもの) で 1 回分の
// スピードテストを実行する。Web Worker とメインスレッドの両方から使う。

import SpeedTest from "@cloudflare/speedtest";

export type TestMode = "light" | "standard" | "precise";
export type TestPhase = "latency" | "download" | "upload";

export type LiveProgress = {
  phase: TestPhase | null;
  /** 0〜1 */
  progress: number;
  down?: number;
  up?: number;
  ping?: number;
  jitter?: number;
};

export type EngineResult = {
  /** Mbps */
  down: number | null;
  up: number | null;
  /** ms (無負荷時) */
  ping: number | null;
  jitter: number | null;
  /** ダウンロード中・アップロード中の遅延 (ms) */
  downLoaded: number | null;
  upLoaded: number | null;
  /** 送受信したデータ量 (bytes) */
  bytes: number;
  durationMs: number;
};

type Step =
  | { type: "latency"; numPackets: number }
  | { type: "download" | "upload"; bytes: number; count: number; bypassMinDuration?: boolean };

const L = (numPackets: number): Step => ({ type: "latency", numPackets });
const D = (bytes: number, count: number, bypassMinDuration = false): Step => ({ type: "download", bytes, count, bypassMinDuration });
const U = (bytes: number, count: number): Step => ({ type: "upload", bytes, count });

// 1 リクエストが 1 秒を超えた時点でその方向の計測は打ち切られるので、
// 回線が遅いほど大きいサイズまで進まない (データ量は回線速度に比例する)。
// packetLoss は Cloudflare の公開 TURN サーバーが廃止予定のため行わない。
const BASE: Step[] = [
  L(1),
  D(1e5, 1, true),
  L(20),
  D(1e5, 9),
  D(1e6, 8),
  U(1e5, 8),
  U(1e6, 6),
  D(1e7, 6),
  U(1e7, 4),
];
export const MODE_STEPS: Record<TestMode, Step[]> = {
  light: BASE,
  standard: [...BASE, D(2.5e7, 4), U(2.5e7, 4)],
  precise: [...BASE, D(2.5e7, 4), U(2.5e7, 4), D(1e8, 3), U(5e7, 3), D(2.5e8, 2)],
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const mbps = (bps: unknown) => {
  const v = num(bps);
  return v === null ? null : v / 1e6;
};

type Results = SpeedTest["results"];

function safe<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

function summarize(r: Results, durationMs: number): EngineResult {
  const points = [...(safe(() => r.getDownloadBandwidthPoints()) ?? []), ...(safe(() => r.getUploadBandwidthPoints()) ?? [])];
  return {
    down: mbps(safe(() => r.getDownloadBandwidth())),
    up: mbps(safe(() => r.getUploadBandwidth())),
    ping: num(safe(() => r.getUnloadedLatency())),
    jitter: num(safe(() => r.getUnloadedJitter())),
    downLoaded: num(safe(() => r.getDownLoadedLatency())),
    upLoaded: num(safe(() => r.getUpLoadedLatency())),
    bytes: points.reduce((s, p) => s + (p.transferSize || p.bytes || 0), 0),
    durationMs,
  };
}

export function runSpeedTest(mode: TestMode, onProgress: (p: LiveProgress) => void, signal?: AbortSignal): Promise<EngineResult> {
  // Worker には window が無いが、エンジンは window.location.origin を参照する
  const g = globalThis as unknown as { window?: unknown };
  if (typeof g.window === "undefined") g.window = globalThis;

  const steps = MODE_STEPS[mode];
  const engine = new SpeedTest({
    autoStart: false,
    measurements: steps,
    // 結果を Cloudflare に送信しない
    logAimApiUrl: null,
    logMeasurementApiUrl: null,
  });
  const started = performance.now();

  return new Promise((resolve, reject) => {
    let phase: TestPhase | null = null;
    let progress = 0;
    let lastEmit = 0;
    const emit = (force = false) => {
      const now = performance.now();
      if (!force && now - lastEmit < 200) return;
      lastEmit = now;
      const r = engine.results;
      onProgress({
        phase,
        progress,
        down: mbps(safe(() => r.getDownloadBandwidth())) ?? undefined,
        up: mbps(safe(() => r.getUploadBandwidth())) ?? undefined,
        ping: num(safe(() => r.getUnloadedLatency())) ?? undefined,
        jitter: num(safe(() => r.getUnloadedJitter())) ?? undefined,
      });
    };

    const onAbort = () => {
      engine.pause();
      reject(new DOMException("aborted", "AbortError"));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });

    engine.onPhaseChange = ({ measurementId, measurement }: { measurementId: number; measurement: { type: string } }) => {
      phase = measurement.type as TestPhase;
      progress = measurementId / steps.length;
      emit(true);
    };
    engine.onResultsChange = () => emit();
    engine.onFinish = (r) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(summarize(r, performance.now() - started));
    };
    engine.onError = (e) => {
      signal?.removeEventListener("abort", onAbort);
      engine.pause();
      reject(new Error(String(e)));
    };
    engine.play();
  });
}
