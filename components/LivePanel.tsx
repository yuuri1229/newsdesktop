"use client";

import { useEffect, useRef, useState } from "react";
import { usePolling } from "@/lib/hooks";
import { fetchSnapshot } from "@/lib/snapshot";
import streams from "@/lib/streams.json";
import { loadYouTubeApi, YT_STATE, type YTPlayer } from "@/lib/youtube";
import { Icon } from "./Icon";

export type Stream = { id: string; title: string; group: string };

/** 表示する配信の設定。変更は lib/streams.json で行う (データ収集側と共有) */
export const STREAMS: Stream[] = streams;

/** scripts/collect.mjs が 5 分ごとに確認した配信状態 */
type StreamStatus = {
  id: string;
  status: "live" | "replaced" | "offline" | "unknown";
  activeId: string | null;
  channelId?: string;
  channel?: string | null;
  activeTitle?: string | null;
  checkedAt: string;
};

const loadStatus = () => fetchSnapshot<StreamStatus[]>("live-streams.json");

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

const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });

/** 配信休止中の表示 (プレーヤーは生成しない) */
function OfflineTile({ stream, info, reason }: { stream: Stream; info?: StreamStatus; reason: string }) {
  const channelUrl = info?.channelId ? `https://www.youtube.com/channel/${info.channelId}` : `https://www.youtube.com/watch?v=${stream.id}`;
  return (
    <div className="live-tile offline">
      <div className="live-head">
        <span className="live-group">{stream.group}</span>
        <span className="live-title">{stream.title}</span>
        <span className="live-lag off">● 休止中</span>
        <a className="live-btn" href={channelUrl} target="_blank" rel="noreferrer" title="チャンネルを開く" aria-label="チャンネルを開く">
          <Icon name="open_in_new" size={15} />
        </a>
      </div>
      <div className="live-video">
        <div className="live-offline">
          <b>配信休止中</b>
          <p>{reason}</p>
          {info?.channel && <p className="muted">チャンネル: {info.channel}</p>}
          {info && <p className="muted">{hm(info.checkedAt)} 確認 ・ 5 分ごとに再確認します</p>}
        </div>
      </div>
    </div>
  );
}

function LiveTile({
  stream,
  videoId,
  replacedTitle,
  audible,
  onToggleAudio,
  onEnded,
}: {
  stream: Stream;
  videoId: string;
  replacedTitle: string | null;
  audible: boolean;
  onToggleAudio: () => void;
  onEnded: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<number>(-1);
  const [lag, setLag] = useState<number | null>(null);
  const [jumps, setJumps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

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
          videoId,
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
            onStateChange: (e) => {
              setState(e.data);
              // ライブ配信が終了した
              if (e.data === YT_STATE.ENDED) onEndedRef.current();
            },
            onError: (e) => {
              // 見つからない / 非公開 = 配信が終わっている
              if (e.data === 100) onEndedRef.current();
              else setError(`${ERRORS[e.data] ?? "再生エラー"}（エラーコード ${e.data}）`);
            },
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
  }, [videoId]);

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
        <span className="live-title" title={replacedTitle ? `代替配信: ${replacedTitle}` : stream.title}>
          {stream.title}
        </span>
        {replacedTitle && (
          <span className="live-alt" title={`設定した配信がオフラインのため、同じチャンネルで配信中の「${replacedTitle}」を表示しています`}>
            代替
          </span>
        )}
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
          href={`https://www.youtube.com/watch?v=${videoId}`}
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
            <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">
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
  const status = usePolling(loadStatus, 2 * 60 * 1000);
  // プレーヤーが配信終了を検知した動画 (次の状態確認で代替配信が見つかるまで休止表示)
  const [ended, setEnded] = useState<Record<string, string>>({});

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
        {STREAMS.map((s) => {
          const info = status.data?.data.find((x) => x.id === s.id);
          // 状態が不明なら設定どおりの配信を試す
          const videoId = info && info.status !== "unknown" ? info.activeId : s.id;
          if (!videoId || info?.status === "offline")
            return <OfflineTile key={s.id} stream={s} info={info} reason="このチャンネルで現在配信中のライブはありません" />;
          if (ended[s.id] === videoId)
            return <OfflineTile key={s.id} stream={s} info={info} reason="配信の終了を検知しました。同じチャンネルの配信を確認中です" />;
          return (
            <LiveTile
              key={`${s.id}:${videoId}`}
              stream={s}
              videoId={videoId}
              replacedTitle={info?.status === "replaced" ? (info.activeTitle ?? "同チャンネルの配信") : null}
              audible={audible === s.id}
              onToggleAudio={() => setAudible((cur) => (cur === s.id ? null : s.id))}
              onEnded={() => {
                setEnded((e) => ({ ...e, [s.id]: videoId }));
                status.refresh();
              }}
            />
          );
        })}
      </div>
    </section>
  );
}
