// バックグラウンドのタブではメインスレッドのタイマーが間引かれ計測が歪むため、Worker で実行する。

import { runSpeedTest, type TestMode } from "./speedtest-engine";

export type WorkerRequest = { type: "start"; mode: TestMode } | { type: "abort" };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: unknown) => void;
};
let ctrl: AbortController | null = null;

ctx.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "abort") {
    ctrl?.abort();
    return;
  }
  ctrl = new AbortController();
  try {
    const result = await runSpeedTest(msg.mode, (p) => ctx.postMessage({ type: "progress", progress: p }), ctrl.signal);
    ctx.postMessage({ type: "done", result });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    ctx.postMessage({ type: "error", aborted, message: err instanceof Error ? err.message : String(err) });
  }
};
