"use client";

import { useCallback, useMemo } from "react";
import { Clock } from "@/components/Clock";
import { MarketPanel } from "@/components/MarketPanel";
import { NewsPanel } from "@/components/NewsPanel";
import { Ticker } from "@/components/Ticker";
import { WeatherPanel } from "@/components/WeatherPanel";
import { usePlace, usePolling } from "@/lib/hooks";
import { loadDomestic, loadLocal, loadWorld } from "@/lib/rss";

const NEWS_INTERVAL = 2 * 60 * 1000;
const LOCAL_INTERVAL = 5 * 60 * 1000;


export default function Home() {
  const place = usePlace();
  const domestic = usePolling(loadDomestic, NEWS_INTERVAL);
  const world = usePolling(loadWorld, NEWS_INTERVAL);

  const localLoader = useCallback(() => loadLocal(place.pref, place.city), [place.pref, place.city]);
  const local = usePolling(place.status === "locating" || !(place.pref || place.city) ? null : localLoader, LOCAL_INTERVAL);

  const tickerItems = useMemo(
    () =>
      [...(domestic.data?.data ?? []), ...(world.data?.data ?? [])].sort(
        (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0),
      ),
    [domestic.data, world.data],
  );

  const areaName = place.city || place.pref || "現在地";

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <span className="logo">◆</span> News Desktop
        </h1>
        <span className="live">
          <span className="dot" /> LIVE
        </span>
        <span className="topbar-loc">
          📍 {[place.pref, place.city].filter(Boolean).join(" ")}
          {place.status === "locating" && " 位置情報を取得中…"}
        </span>
        <button
          className="fs-btn"
          onClick={() =>
            document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
          }
        >
          ⛶ 全画面
        </button>
      </header>

      <main className="grid">
        <div className="col col-left">
          <Clock />
          <WeatherPanel place={place} />
        </div>
        <div className="col col-mid">
          <NewsPanel title="国内ニュース" sub="Yahoo!ニュース" feed={domestic} className="grow-3" />
          <NewsPanel title={`${areaName} 周辺ニュース`} sub={`Yahoo!ニュース / Google News・${place.pref || "周辺"}`} feed={local} className="grow-2" />
        </div>
        <div className="col col-right">
          <MarketPanel />
          <NewsPanel title="国際ニュース" sub="Yahoo!ニュース" feed={world} className="grow-3" />
        </div>
      </main>

      <Ticker items={tickerItems} />
    </div>
  );
}
