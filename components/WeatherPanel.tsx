"use client";

import { useCallback } from "react";
import { usePolling, type Place } from "@/lib/hooks";
import { fetchWeather, weatherInfo, windDirLabel } from "@/lib/weather";
import { Empty, Panel } from "./Panel";

const WD = ["日", "月", "火", "水", "木", "金", "土"];

export function WeatherPanel({ place }: { place: Place }) {
  const loader = useCallback(() => fetchWeather(place.lat, place.lon), [place.lat, place.lon]);
  const { data, error, loading, updatedAt, refresh } = usePolling(place.status === "locating" ? null : loader, 5 * 60 * 1000);
  const where = [place.pref, place.city].filter(Boolean).join(" ") || `${place.lat}, ${place.lon}`;

  return (
    <Panel
      title="天気"
      sub={<>{where}{place.status === "fallback" && <em className="muted">（位置情報オフ）</em>}</>}
      updatedAt={updatedAt}
      error={error}
      loading={loading}
      onRefresh={refresh}
      className="weather"
    >
      {!data ? (
        <Empty error={error} loading={loading || place.status === "locating"} />
      ) : (
        <>
          <div className="wx-now">
            <div className="wx-icon">{weatherInfo(data.current.code, data.current.isDay).icon}</div>
            <div>
              <div className="wx-temp">
                {data.current.temp.toFixed(1)}
                <small>℃</small>
              </div>
              <div className="wx-label">{weatherInfo(data.current.code, data.current.isDay).label}</div>
            </div>
            <dl className="wx-stats">
              <div><dt>体感</dt><dd>{data.current.feels.toFixed(1)}℃</dd></div>
              <div><dt>湿度</dt><dd>{data.current.humidity}%</dd></div>
              <div><dt>風</dt><dd>{windDirLabel(data.current.windDir)} {data.current.windSpeed.toFixed(1)}m/s</dd></div>
              <div><dt>降水</dt><dd>{data.current.precip}mm</dd></div>
              <div><dt>気圧</dt><dd>{Math.round(data.current.pressure)}hPa</dd></div>
            </dl>
          </div>

          <h3 className="sub-h">時間ごとの予報</h3>
          <div className="wx-hourly">
            {data.hourly.filter((_, i) => i % 2 === 0).slice(0, 12).map((h) => (
              <div key={h.time}>
                <span className="muted">{Number(h.time.slice(11, 13))}時</span>
                <span className="wx-sm-icon">{weatherInfo(h.code).icon}</span>
                <b>{Math.round(h.temp)}°</b>
                <span className="pop">{h.pop ?? 0}%</span>
              </div>
            ))}
          </div>

          <h3 className="sub-h">週間予報</h3>
          <div className="wx-daily">
            {data.daily.map((d, i) => {
              const lo = Math.min(...data.daily.map((x) => x.min));
              const span = Math.max(...data.daily.map((x) => x.max)) - lo || 1;
              const wd = WD[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
              return (
                <div key={d.date}>
                  <span className={`day ${wd === "日" ? "sun" : wd === "土" ? "sat" : ""}`}>
                    {i === 0 ? "今日" : `${Number(d.date.slice(8))}(${wd})`}
                  </span>
                  <span className="wx-sm-icon">{weatherInfo(d.code).icon}</span>
                  <span className="lo">{Math.round(d.min)}°</span>
                  <span className="range" aria-hidden>
                    <i style={{ left: `${((d.min - lo) / span) * 100}%`, right: `${100 - ((d.max - lo) / span) * 100}%` }} />
                  </span>
                  <span className="hi">{Math.round(d.max)}°</span>
                  <span className="pop">{d.pop ?? 0}%</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}
