"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsItem } from "./rss";

export type AlertKind = "速報" | "主要";
export type Alert = NewsItem & { id: string; kind: AlertKind; category: string };
export type AlertSettings = { sound: boolean; popup: boolean; desktop: boolean; volume: number };

const SETTINGS_KEY = "newsdesktop:alert-settings";
const SEEN_KEY = "newsdesktop:alert-seen";
const DEFAULT_SETTINGS: AlertSettings = { sound: true, popup: true, desktop: false, volume: 0.6 };
/** これより古い記事は「新着」とみなさない */
const MAX_AGE_MS = 60 * 60 * 1000;
const SEEN_LIMIT = 400;

const keyOf = (it: NewsItem) => it.title.replace(/\s+/g, "");
export const isBreakingTitle = (title: string) => /速報|緊急|地震情報|津波|特別警報/.test(title);

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function useAlertSettings() {
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_SETTINGS);
  useEffect(() => setSettings(load(SETTINGS_KEY, DEFAULT_SETTINGS)), []);
  const update = useCallback((patch: Partial<AlertSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      save(SETTINGS_KEY, next);
      return next;
    });
  }, []);
  return [settings, update] as const;
}

// ---- 通知音 (Web Audio で合成。ブラウザの自動再生制限のため、ユーザー操作で unlock が必要) ----

let ctx: AudioContext | null = null;

export function audioReady() {
  return ctx?.state === "running";
}

/** クリックなどのユーザー操作の中で呼ぶ */
export async function unlockAudio() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return false;
  ctx ??= new AC();
  // 環境によって resume() が解決しないことがあるので待ちすぎない
  if (ctx.state === "suspended") await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
  return ctx.state === "running";
}

/** 速報チャイム: 上昇する 3 音を 2 回 (主要ニュースは 1 回) */
export function playChime(kind: AlertKind, volume: number) {
  if (!ctx || ctx.state !== "running") return false;
  const notes = [880, 1174.66, 1567.98];
  const repeats = kind === "速報" ? 2 : 1;
  const start = ctx.currentTime + 0.05;
  for (let r = 0; r < repeats; r++) {
    notes.forEach((freq, i) => {
      const t = start + r * 0.9 + i * 0.16;
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35 * volume + 0.0001, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  }
  return true;
}

/**
 * 監視対象のリストから新着の速報を検出する。
 * 初回はそれまでの記事を既読として登録するだけで通知しない (再読み込みでも再通知しない)。
 */
export function useBreakingDetector(
  sources: { category: string; items: NewsItem[] | undefined; all?: boolean }[],
  onNew: (alerts: Alert[]) => void,
) {
  const seen = useRef<Set<string> | null>(null);
  const primed = useRef(new Set<string>());
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const signature = sources.map((s) => `${s.category}:${s.items?.length ?? -1}:${s.items?.[0]?.title ?? ""}`).join("|");

  useEffect(() => {
    if (!seen.current) {
      try {
        seen.current = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
      } catch {
        seen.current = new Set();
      }
    }
    const now = Date.now();
    const fresh: Alert[] = [];
    for (const src of sources) {
      if (!src.items) continue;
      // 各ソースの初回取得は既読登録のみ
      const firstTime = !primed.current.has(src.category);
      primed.current.add(src.category);
      for (const it of src.items) {
        const key = keyOf(it);
        const breaking = isBreakingTitle(it.title);
        if (!src.all && !breaking) continue;
        if (seen.current.has(key)) continue;
        seen.current.add(key);
        if (firstTime) continue;
        if (it.date && now - it.date.getTime() > MAX_AGE_MS) continue;
        fresh.push({ ...it, id: `${key}-${now}`, kind: breaking ? "速報" : "主要", category: src.category });
      }
    }
    save(SEEN_KEY, [...seen.current].slice(-SEEN_LIMIT));
    if (fresh.length) onNewRef.current(fresh);
    // signature が変わったとき (新しいデータが来たとき) だけ判定する
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
}
