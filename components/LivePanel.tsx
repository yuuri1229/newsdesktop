"use client";

import { useEffect, useRef, useState } from "react";
import { loadYouTubeApi, YT_STATE, type YTPlayer } from "@/lib/youtube";
import { Icon } from "./Icon";

export type Stream = { id: string; title: string; group: string };

export const STREAMS: Stream[] = [
  { id: "IepIF8OP4pg", title: "東京都町田市", group: "ライブカメラ" },
  { id: "reo2ABoeXvE", title: "石川県金沢市 県庁舎", group: "ライブカメラ" },
  { id: "I5_vUnu1GN4", title: "地震1", group: "地震情報" },
  { id: "coYw-eVU0Ks", title: "朝日系", group: "ニュース" },
];

/** ライブ端からの遅れがこれを超えたら自動で最新位置へ移動する [秒] */
const MAX_LAG_S = 6;
const CHECK_MS = 2000;

const ERRORS: Record<number, string> = {
  2: "動画 ID が正しくありません",
  5: "ブラウザで再生できない形式です",
  100: "配信が見つかりません（終了または非公開）",
  101: "この配信は埋め込み再生が許可されていません",
  150: "この配信は埋め込み再生が許可されていません",
  152: "この配信は埋め込み再生が許可されていません",
  153: "プレーヤーの設定エラー（参照元情報が送信されていない可能性）",
};

function LiveTile({ stream, audible, onToggleAudio }: { stream: Stream; audible: boolean; onToggleAudio: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<number>(-1);
  const [lag, setLag] = useState<number | null>(null);
  const [jumps, setJumps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const goLive = () => {
    const p = player.current;
    if (!p) return;
    p.seekTo(p.getDuration(), true);
    p.playVideo();
  };

  // プレーヤー生成 (最初は必ずミュートで自動再生)
  useEffect(() => {
    let disposed = false;
    const el = document.createElement("div");
    host.current?.appendChild(el);
    loadYouTubeApi()
      .then((YT) => {
        if (disposed) return;
        player.current = new YT.Player(el, {
          videoId: stream.id,
          playerVars: {
            autoplay: 1,
            mute: 1,
            playsinline: 1,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            origin: location.origin,
          },
          events: {
            onReady: (e) => {
              e.target.mute();
              e.target.playVideo();
              setReady(true);
            },
            onStateChange: (e) => setState(e.data),
            onError: (e) => setError(`${ERRORS[e.data] ?? "再生エラー"}（エラーコード ${e.data}）`),
          },
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      disposed = true;
      player.current?.destroy();
      player.current = null;
      el.remove();
    };
  }, [stream.id]);

  // 遅延監視: ライブ端 (getDuration) と再生位置の差を測り、閾値を超えたら追いつく
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = player.current;
      if (!p) return;
      const st = p.getPlayerState();
      if (st !== YT_STATE.PLAYING) return;
      const l = Math.max(0, p.getDuration() - p.getCurrentTime());
      setLag(l);
      if (l > MAX_LAG_S) {
        p.seekTo(p.getDuration(), true);
        setJumps((n) => n + 1);
        setLag(Math.max(0, p.getDuration() - p.getCurrentTime()));
      }
    }, CHECK_MS);
    // タブ復帰時は停止/遅延していることが多いので即座にライブへ
    const onVisible = () => document.visibilityState === "visible" && goLive();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready]);

  // 音声: 選ばれたタイルだけミュート解除
  useEffect(() => {
    const p = player.current;
    if (!p || !ready) return;
    if (audible) {
      p.unMute();
      p.setVolume(100);
    } else {
      p.mute();
    }
  }, [audible, ready]);

  const playing = state === YT_STATE.PLAYING;
  const lagLabel =
    state === YT_STATE.BUFFERING
      ? "読み込み中"
      : state === YT_STATE.PAUSED
        ? "一時停止"
        : lag == null
          ? "接続中"
          : lag < 3
            ? "LIVE"
            : `LIVE −${lag.toFixed(0)}秒`;

  return (
    <div className={`live-tile ${audible ? "audible" : ""}`}>
      <div className="live-head">
        <span className="live-group">{stream.group}</span>
        <span className="live-title" title={stream.title}>
          {stream.title}
        </span>
        <span
          className={`live-lag ${playing && lag != null && lag < 3 ? "ok" : ""}`}
          title={`ライブ端からの遅れ（${MAX_LAG_S}秒を超えると自動で最新位置へ移動・自動追従 ${jumps} 回）`}
        >
          ● {lagLabel}
        </span>
        <button className="live-btn" onClick={goLive} title="最新位置（ライブ）へ移動" aria-label="ライブへ移動">
          <Icon name="fast_forward" size={16} />
        </button>
        <button
          className={`live-btn ${audible ? "on" : ""}`}
          onClick={onToggleAudio}
          title={audible ? "ミュートにする" : "音声をオンにする（他の映像はミュート）"}
          aria-label={audible ? "ミュート" : "ミュート解除"}
          aria-pressed={audible}
        >
          <Icon name={audible ? "volume_up" : "volume_off"} size={16} />
        </button>
        <a
          className="live-btn"
          href={`https://www.youtube.com/watch?v=${stream.id}`}
          target="_blank"
          rel="noreferrer"
          title="YouTube で開く"
          aria-label="YouTube で開く"
        >
          <Icon name="open_in_new" size={15} />
        </a>
      </div>
      <div className="live-video">
        <div className="live-player" ref={host} />
        {error && (
          <div className="live-error">
            <p>{error}</p>
            <a href={`https://www.youtube.com/watch?v=${stream.id}`} target="_blank" rel="noreferrer">
              YouTube で開く
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function LivePanel() {
  // 同時に音を出すのは 1 本だけ (null = 全ミュート)
  const [audible, setAudible] = useState<string | null>(null);
  return (
    <section className="panel live-panel">
      <header className="panel-head">
        <h2>ライブ映像</h2>
        <span className="panel-sub">YouTube Live・自動で最新位置に追従</span>
        <span className="panel-status">
          <button
            className={`live-mute-all ${audible ? "" : "muted"}`}
            onClick={() => setAudible(null)}
            disabled={!audible}
            title="すべてミュート"
          >
            <Icon name="volume_off" size={15} /> {audible ? "すべてミュート" : "ミュート中"}
          </button>
        </span>
      </header>
      <div className="live-grid">
        {STREAMS.map((s) => (
          <LiveTile
            key={s.id}
            stream={s}
            audible={audible === s.id}
            onToggleAudio={() => setAudible((cur) => (cur === s.id ? null : s.id))}
          />
        ))}
      </div>
    </section>
  );
}
