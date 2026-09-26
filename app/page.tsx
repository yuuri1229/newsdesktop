"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertControl, AlertPopups, notify } from "@/components/BreakingAlerts";
import { unlockAudio, useAlertSettings, useBreakingDetector, type Alert } from "@/lib/alerts";
import { Clock } from "@/components/Clock";
import { MarketPanel } from "@/components/MarketPanel";
import { NewsPanel } from "@/components/NewsPanel";
import { Ticker } from "@/components/Ticker";
import { WeatherPanel } from "@/components/WeatherPanel";
import { usePlace, usePolling } from "@/lib/hooks";
import { loadDomestic, loadLocal, loadTop, loadWorld } from "@/lib/rss";

const NEWS_INTERVAL = 2 * 60 * 1000;
const LOCAL_INTERVAL = 5 * 60 * 1000;


export default function Home() {
  const place = usePlace();
  const domestic = usePolling(loadDomestic, NEWS_INTERVAL);
  const world = usePolling(loadWorld, NEWS_INTERVAL);
  const top = usePolling(loadTop, NEWS_INTERVAL);

  const localLoader = useCallback(() => loadLocal(place.pref, place.city), [place.pref, place.city]);
  const local = usePolling(place.status === "locating" || !(place.pref || place.city) ? null : localLoader, LOCAL_INTERVAL);

  const tickerItems = useMemo(
    () =>
      [...(top.data?.data ?? []), ...(domestic.data?.data ?? []), ...(world.data?.data ?? [])]
        .filter((it, i, arr) => arr.findIndex((x) => x.title === it.title) === i)
        .sort(
        (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0),
      ),
    [top.data, domestic.data, world.data],
  );

  const areaName = place.city || place.pref || "現在地";

  // ---- 速報通知 ----
  const [alertSettings, updateAlertSettings] = useAlertSettings();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const pushAlerts = (fresh: Alert[]) => {
    if (alertSettings.popup) setAlerts((prev) => [...fresh, ...prev].slice(0, 20));
    notify(fresh, alertSettings);
  };
  useBreakingDetector(
    [
      { category: "主要", items: top.data?.data, all: true },
      { category: "国内", items: domestic.data?.data },
      { category: "国際", items: world.data?.data },
      { category: areaName, items: local.data?.data },
    ],
    pushAlerts,
  );
  const testAlert = async () => {
    await unlockAudio();
    pushAlerts([
      {
        id: `test-${Date.now()}`,
        kind: "速報",
        category: "テスト",
        title: "【テスト】速報通知のテストです。新しい速報が入るとこのように表示されます",
        link: "#",
        date: new Date(),
        source: "News Desktop",
      },
    ]);
  };

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
        <AlertControl settings={alertSettings} update={updateAlertSettings} onTest={testAlert} />
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
      <AlertPopups alerts={alerts} onDismiss={(id) => setAlerts((prev) => prev.filter((a) => a.id !== id))} />
    </div>
  );
}
