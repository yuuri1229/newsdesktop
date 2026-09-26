"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "./fetcher";

export type Polled<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: Date | null;
  refresh: () => void;
};

/** fn を intervalMs ごとに実行する。タブ復帰時にも即時更新。 */
export function usePolling<T>(fn: (() => Promise<T>) | null, intervalMs: number): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    const f = fnRef.current;
    if (!f) return;
    setLoading(true);
    try {
      setData(await f());
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fn) return;
    run();
    const id = setInterval(run, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // fn の同一性が変わった (位置が変わった) ときに再購読する
  }, [fn, intervalMs, run]);

  return { data, error, loading, updatedAt, refresh: run };
}

export function useNow(intervalMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export type Place = {
  lat: number;
  lon: number;
  pref: string;
  city: string;
  status: "locating" | "gps" | "fallback";
};

const DEFAULT_PLACE: Place = { lat: 35.6812, lon: 139.7671, pref: "東京都", city: "千代田区", status: "fallback" };
const STORAGE_KEY = "newsdesktop:place";

type Geo = { principalSubdivision?: string; city?: string; locality?: string };

async function reverseGeocode(lat: number, lon: number): Promise<{ pref: string; city: string }> {
  const g = await fetchJson<Geo>(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ja`,
  );
  return { pref: g.principalSubdivision ?? "", city: g.city || g.locality || "" };
}

/** ブラウザの位置情報から現在地を求める。拒否時は前回値 → 東京駅付近。 */
export function usePlace(): Place {
  const [place, setPlace] = useState<Place>(() => ({ ...DEFAULT_PLACE, status: "locating" }));

  useEffect(() => {
    let cancelled = false;
    let cached: Place | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) cached = JSON.parse(raw) as Place;
    } catch {}
    if (cached) setPlace({ ...cached, status: "locating" });

    const fallback = () => {
      if (!cancelled) setPlace({ ...(cached ?? DEFAULT_PLACE), status: "fallback" });
    };
    if (!("geolocation" in navigator)) {
      fallback();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(3));
        const lon = Number(pos.coords.longitude.toFixed(3));
        let names = { pref: "", city: "" };
        try {
          names = await reverseGeocode(lat, lon);
        } catch {}
        if (cancelled) return;
        const next: Place = { lat, lon, ...names, status: "gps" };
        setPlace(next);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {}
      },
      fallback,
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return place;
}
