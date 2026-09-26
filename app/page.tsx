"use client";

import { useCallback, useMemo } from "react";
import { Clock } from "@/components/Clock";
import { MarketPanel } from "@/components/MarketPanel";
import { NewsPanel } from "@/components/NewsPanel";
import { Ticker } from "@/components/Ticker";
import { WeatherPanel } from "@/components/WeatherPanel";
import { usePlace, usePolling } from "@/lib/hooks";
import { FEEDS, fetchFeeds } from "@/lib/rss";

const NEWS_INTERVAL = 2 * 60 * 1000;
const LOCAL_INTERVAL = 5 * 60 * 1000;

const loadDomestic = () => fetchFeeds(FEEDS.domestic);
const loadWorld = () => fetchFeeds(FEEDS.world);

export default function Home() {
  const place = usePlace();
  const domestic = usePolling(loadDomestic, NEWS_INTERVAL);
  const world = usePolling(loadWorld, NEWS_INTERVAL);

  const loadLocal = useCallback(() => fetchFeeds(FEEDS.local(place.pref, place.city)), [place.pref, place.city]);
  const local = usePolling(place.status === "locating" || !(place.pref || place.city) ? null : loadLocal, LOCAL_INTERVAL);

  const tickerItems = useMemo(
    () =>
      [...(domestic.data ?? []), ...(world.data ?? [])].sort(
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
          <NewsPanel title="国内ニュース" sub="NHK / Google News" feed={domestic} className="grow-3" />
          <NewsPanel title={`${areaName} 周辺ニュース`} sub="Google News（24時間以内）" feed={local} className="grow-2" />
        </div>
        <div className="col col-right">
          <MarketPanel />
          <NewsPanel title="国際ニュース" sub="NHK / Google News" feed={world} className="grow-3" />
        </div>
      </main>

      <Ticker items={tickerItems} />
    </div>
  );
}
