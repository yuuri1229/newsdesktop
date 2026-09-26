"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { audioReady, playChime, unlockAudio, type Alert, type AlertSettings } from "@/lib/alerts";

const hm = (d: Date | null) =>
  d ? d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }) : "";

const POPUP_MS = 30_000;
const MAX_POPUPS = 4;

/** 画面右上に積み重なる速報ポップアップ。ホバー中は自動で消えない。 */
export function AlertPopups({ alerts, onDismiss }: { alerts: Alert[]; onDismiss: (id: string) => void }) {
  if (!alerts.length) return null;
  return (
    <div className="alerts" role="region" aria-label="速報通知" aria-live="assertive">
      {alerts.slice(0, MAX_POPUPS).map((a) => (
        <article key={a.id} className={`alert ${a.kind === "速報" ? "alert-breaking" : ""}`}>
          <header>
            <span className="alert-kind">{a.kind === "速報" ? "速報" : "ニュース"}</span>
            <span className="alert-meta">
              {a.category} ・ {hm(a.date)} ・ {a.source}
            </span>
            <button className="alert-close" onClick={() => onDismiss(a.id)} aria-label="閉じる">
              <Icon name="close" size={18} />
            </button>
          </header>
          <a className="alert-title" href={a.link} target="_blank" rel="noreferrer">
            {a.title}
          </a>
          <div className="alert-timer" style={{ animationDuration: `${POPUP_MS}ms` }} onAnimationEnd={() => onDismiss(a.id)} />
        </article>
      ))}
      {alerts.length > MAX_POPUPS && <div className="alert-more">ほか {alerts.length - MAX_POPUPS} 件</div>}
    </div>
  );
}

/** 新着の速報に対して音・デスクトップ通知を出す */
export function notify(alerts: Alert[], settings: AlertSettings) {
  const top = alerts.find((a) => a.kind === "速報") ?? alerts[0];
  if (settings.sound) playChime(top.kind, settings.volume);
  if (settings.desktop && "Notification" in window && Notification.permission === "granted" && document.hidden) {
    for (const a of alerts.slice(0, 3)) {
      const n = new Notification(`【${a.kind === "速報" ? "速報" : a.category}】${a.title}`, {
        body: `${a.source} ${hm(a.date)}`,
        tag: a.id,
      });
      n.onclick = () => {
        window.focus();
        window.open(a.link, "_blank", "noreferrer");
      };
    }
  }
}

/** ヘッダーの通知設定ボタン + メニュー */
export function AlertControl({
  settings,
  update,
  onTest,
}: {
  settings: AlertSettings;
  update: (p: Partial<AlertSettings>) => void;
  onTest: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [soundOk, setSoundOk] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 自動再生制限: ページ上の最初のクリックで音声を有効化する
  useEffect(() => {
    const unlock = async () => setSoundOk(await unlockAudio());
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const enabled = settings.sound || settings.popup || settings.desktop;
  const needsClick = settings.sound && !soundOk && !audioReady();
  const perm = typeof Notification !== "undefined" ? Notification.permission : "denied";

  const toggleDesktop = async (on: boolean) => {
    if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    update({ desktop: on && typeof Notification !== "undefined" && Notification.permission === "granted" });
  };

  return (
    <div className="alert-ctl" ref={ref}>
      <button
        className={`alert-btn ${enabled ? "on" : ""}`}
        onClick={() => {
          setOpen((o) => !o);
          unlockAudio().then(setSoundOk);
        }}
        aria-expanded={open}
      >
        <Icon name={enabled ? "notifications_active" : "notifications_off"} size={16} />
        速報通知 {enabled ? "ON" : "OFF"}
        {needsClick && <span className="alert-hint">（クリックで音を有効化）</span>}
      </button>
      {open && (
        <div className="alert-menu" role="menu">
          <label>
            <input type="checkbox" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} />
            通知音
          </label>
          <label className="vol">
            音量
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.1}
              value={settings.volume}
              disabled={!settings.sound}
              onChange={(e) => update({ volume: Number(e.target.value) })}
            />
          </label>
          <label>
            <input type="checkbox" checked={settings.popup} onChange={(e) => update({ popup: e.target.checked })} />
            ポップアップ表示
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.desktop}
              disabled={perm === "denied"}
              onChange={(e) => toggleDesktop(e.target.checked)}
            />
            デスクトップ通知（別タブ表示中）
          </label>
          {perm === "denied" && <p className="alert-note">ブラウザで通知がブロックされています</p>}
          <p className="alert-note">対象: Yahoo!ニュース主要トピックスの新着と、「速報」を含む見出し</p>
          <button className="alert-test" onClick={onTest}>
            <Icon name="play_arrow" size={16} />
            テスト通知
          </button>
        </div>
      )}
    </div>
  );
}
