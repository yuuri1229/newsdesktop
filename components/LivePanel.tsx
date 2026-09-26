"use client";

import { useEffect, useRef, useState } from "react";
import { usePolling } from "@/lib/hooks";
import { fetchSnapshot } from "@/lib/snapshot";
import streams from "@/lib/streams.json";
import { loadYouTubeApi, YT_STATE, type YTPlayer } from "@/lib/youtube";
import { Icon } from "./Icon";

export type Stream = { id: string; title: string; group: string; channelId?: string };

/** 表示する配信の設定。変更は lib/streams.json で行う (データ収集側と共有) */
export const STREAMS: Stream[] = streams;

/** scripts/collect.mjs が 5 分ごとに確認した配信状態 (主にチャンネル ID の解決に使う) */
type StreamStatus = {
  id: string;
  status: "live" | "replaced" | "offline" | "unknown";
  activeId: string | null;
  channelId?: string | null;
  channel?: string | null;
  activeTitle?: string | null;
  checkedAt: string;
};

const loadStatus = () => fetchSnapshot<StreamStatus[]>("live-streams.json");

/** ライブ端からの遅れがこれを超えたら自動で最新位置へ移動する [秒] */
const MAX_LAG_S = 6;
const CHECK_MS = 2000;
/** 再生が始まらなければ配信していないとみなすまでの時間 */
const START_TIMEOUT_MS = 30_000;
/** 休止中の配信を再確認する間隔 */
const RETRY_MS = 5 * 60 * 1000;

const EMBED_BLOCKED: Record<number, string> = {
  101: "この配信は埋め込み再生が許可されていません",
  150: "この配信は埋め込み再生が許可されていません",
  152: "この配信は埋め込み再生が許可されていません",
  153: "プレーヤーの設定エラー（参照元情報が送信されていない可能性）",
  5: "ブラウザで再生できない形式です",
};

/** 埋め込み禁止などで再生できない状態 (YouTube の状態値と重ならない値) */
const BLOCKED_STATE = -100;

type Target = { kind: "video"; id: string } | { kind: "channel"; id: string };

const hm = (d: Date) => d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
const watchUrl = (t: Target) =>
  t.kind === "video" ? `https://www.youtube.com/watch?v=${t.id}` : `https://www.youtube.com/channel/${t.id}/live`;

/**
 * 1 本分のプレーヤー。配信していない (終了・アーカイブ・待機中・見つからない) と判断したら onUnavailable を呼ぶ。
 */
function Player({
  target,
  audible,
  onUnavailable,
  onLive,
  onLag,
  registerGoLive,
}: {
  target: Target;
  audible: boolean;
  onUnavailable: (reason: string) => void;
  onLive: (title: string | null) => void;
  onLag: (lag: number | null, state: number) => void;
  registerGoLive: (fn: () => void) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef(error);
  errorRef.current = error;
  const cb = useRef({ onUnavailable, onLive, onLag, registerGoLive });
  cb.current = { onUnavailable, onLive, onLag, registerGoLive };

  useEffect(() => {
    let disposed = false;
    let everPlayed = false;
    let liveChecked = false;
    const el = document.createElement("div");
    host.current?.appendChild(el);
    const unavailable = (reason: string) => {
      if (!disposed) cb.current.onUnavailable(reason);
    };
    // 一定時間再生が始まらない = 待機中 / 配信なし
    const startTimer = setTimeout(() => {
      if (!everPlayed) unavailable("配信が開始されていません");
    }, START_TIMEOUT_MS);

    loadYouTubeApi()
      .then((YT) => {
        if (disposed) return;
        player.current = new YT.Player(el, {
          ...(target.kind === "video" ? { videoId: target.id } : { videoId: "live_stream" }),
          playerVars: {
            autoplay: 1,
            mute: 1,
            playsinline: 1,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            origin: location.origin,
            ...(target.kind === "channel" ? { channel: target.id } : {}),
          },
          events: {
            onReady: (e) => {
              e.target.mute();
              e.target.playVideo();
              setReady(true);
            },
            onStateChange: (e) => {
              if (e.data === YT_STATE.PLAYING) {
                everPlayed = true;
                if (!liveChecked) {
                  liveChecked = true;
                  // 再生開始直後はメタデータが揃わないことがあるので少し待って確認
                  setTimeout(() => {
                    const d = player.current?.getVideoData();
                    if (d && d.isLive === false) unavailable("ライブ配信は終了しています（アーカイブ）");
                    else cb.current.onLive(d?.title ?? null);
                  }, 3000);
                }
              }
              if (e.data === YT_STATE.ENDED) unavailable("配信が終了しました");
            },
            onError: (e) => {
              const blocked = EMBED_BLOCKED[e.data];
              // 埋め込み禁止は「休止」ではないのでその旨を表示
              if (blocked && target.kind === "video") {
                setError(`${blocked}（エラーコード ${e.data}）`);
                cb.current.onLag(null, BLOCKED_STATE);
              }
              else unavailable(e.data === 100 ? "配信が見つかりません" : `再生できません（エラーコード ${e.data}）`);
            },
          },
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      disposed = true;
      clearTimeout(startTimer);
      player.current?.destroy();
      player.current = null;
      el.remove();
    };
  }, [target.kind, target.id]);

  // 遅延監視: ライブ端 (getDuration) と再生位置の差を測り、閾値を超えたら追いつく
  useEffect(() => {
    if (!ready) return;
    const goLive = () => {
      const p = player.current;
      if (!p) return;
      p.seekTo(p.getDuration(), true);
      p.playVideo();
    };
    cb.current.registerGoLive(goLive);
    const id = setInterval(() => {
      const p = player.current;
      if (!p) return;
      if (errorRef.current) return;
      const st = p.getPlayerState();
      if (st !== YT_STATE.PLAYING) return cb.current.onLag(null, st);
      let lag = Math.max(0, p.getDuration() - p.getCurrentTime());
      if (lag > MAX_LAG_S) {
        p.seekTo(p.getDuration(), true);
        lag = Math.max(0, p.getDuration() - p.getCurrentTime());
      }
      cb.current.onLag(lag, st);
    }, CHECK_MS);
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

  return (
    <div className="live-video">
      <div className="live-player" ref={host} />
      {error && (
        <div className="live-error">
          <p>{error}</p>
          <a href={watchUrl(target)} target="_blank" rel="noreferrer">
            YouTube で開く
          </a>
        </div>
      )}
    </div>
  );
}

type Phase = { step: "primary" } | { step: "channel" } | { step: "offline"; reason: string; at: Date };

/**
 * 1 枠分。設定した配信 → (オフラインなら) 同じチャンネルの配信中ライブ → (それもなければ) 配信休止中。
 * 休止中は 5 分ごとに最初から再確認する。
 */
function LiveSlot({
  stream,
  info,
  audible,
  onToggleAudio,
}: {
  stream: Stream;
  info?: StreamStatus;
  audible: boolean;
  onToggleAudio: () => void;
}) {
  const channelId = stream.channelId ?? info?.channelId ?? null;
  // データ収集側で配信中の動画が分かっていればそれを優先
  const primaryId = info && (info.status === "live" || info.status === "replaced") && info.activeId ? info.activeId : stream.id;
  const [phase, setPhase] = useState<Phase>({ step: "primary" });
  const [liveTitle, setLiveTitle] = useState<string | null>(null);
  const [lag, setLag] = useState<{ lag: number | null; state: number }>({ lag: null, state: -1 });
  const goLive = useRef<() => void>(() => {});

  useEffect(() => {
    if (phase.step !== "offline") return;
    const t = setTimeout(() => setPhase({ step: "primary" }), RETRY_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // 収集側の結果が変わったら (配信再開など) やり直す
  useEffect(() => setPhase({ step: "primary" }), [primaryId]);

  const target: Target | null =
    phase.step === "primary"
      ? { kind: "video", id: primaryId }
      : phase.step === "channel" && channelId
        ? { kind: "channel", id: channelId }
        : null;

  const unavailable = (reason: string) => {
    setLiveTitle(null);
    setLag({ lag: null, state: -1 });
    if (phase.step === "primary" && channelId) setPhase({ step: "channel" });
    else setPhase({ step: "offline", reason, at: new Date() });
  };

  const replaced = phase.step === "channel" || primaryId !== stream.id;
  const offline = phase.step === "offline";
  const lagLabel = offline
    ? "休止中"
    : lag.state === BLOCKED_STATE
      ? "再生不可"
      : lag.state === YT_STATE.BUFFERING
      ? "読み込み中"
      : lag.state === YT_STATE.PAUSED
        ? "一時停止"
        : lag.lag == null
          ? phase.step === "channel"
            ? "代替配信を確認中"
            : "接続中"
          : lag.lag < 3
            ? "LIVE"
            : `LIVE −${lag.lag.toFixed(0)}秒`;
  const openUrl = target ? watchUrl(target) : channelId ? `https://www.youtube.com/channel/${channelId}` : watchUrl({ kind: "video", id: stream.id });

  return (
    <div className={`live-tile ${audible && !offline ? "audible" : ""} ${offline ? "offline" : ""}`}>
      <div className="live-head">
        <span className="live-group">{stream.group}</span>
        <span className="live-title" title={replaced && liveTitle ? `代替配信: ${liveTitle}` : stream.title}>
          {stream.title}
        </span>
        {replaced && !offline && (
          <span
            className="live-alt"
            title={`設定した配信がオフラインのため、同じチャンネルで配信中のライブ${liveTitle ? `「${liveTitle}」` : ""}を表示しています`}
          >
            代替
          </span>
        )}
        <span
          className={`live-lag ${offline || lag.state === BLOCKED_STATE ? "off" : lag.lag != null && lag.lag < 3 ? "ok" : ""}`}
          title={`ライブ端からの遅れ（${MAX_LAG_S}秒を超えると自動で最新位置へ移動）`}
        >
          ● {lagLabel}
        </span>
        {!offline && (
          <>
            <button className="live-btn" onClick={() => goLive.current()} title="最新位置（ライブ）へ移動" aria-label="ライブへ移動">
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
          </>
        )}
        <a className="live-btn" href={openUrl} target="_blank" rel="noreferrer" title="YouTube で開く" aria-label="YouTube で開く">
          <Icon name="open_in_new" size={15} />
        </a>
      </div>
      {target ? (
        <Player
          key={`${target.kind}:${target.id}`}
          target={target}
          audible={audible}
          onUnavailable={unavailable}
          onLive={setLiveTitle}
          onLag={(l, st) => setLag({ lag: l, state: st })}
          registerGoLive={(fn) => (goLive.current = fn)}
        />
      ) : (
        <div className="live-video">
          <div className="live-offline">
            <b>配信休止中</b>
            <p>{offline ? phase.reason : "配信を確認中"}</p>
            <p className="muted">{channelId ? "同じチャンネルにも配信中のライブはありません" : "チャンネル情報を取得できませんでした"}</p>
            {info?.channel && <p className="muted">チャンネル: {info.channel}</p>}
            {offline && <p className="muted">{hm(phase.at)} 確認 ・ 5 分ごとに再確認します</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function LivePanel() {
  // 同時に音を出すのは 1 本だけ (null = 全ミュート)
  const [audible, setAudible] = useState<string | null>(null);
  const status = usePolling(loadStatus, 5 * 60 * 1000);

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
          <LiveSlot
            key={s.id}
            stream={s}
            info={status.data?.data.find((x) => x.id === s.id)}
            audible={audible === s.id}
            onToggleAudio={() => setAudible((cur) => (cur === s.id ? null : s.id))}
          />
        ))}
      </div>
    </section>
  );
}
