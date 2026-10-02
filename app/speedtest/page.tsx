"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { HourBars, LineChart, fmtTime, type Series } from "@/components/speed/charts";
import { useNow } from "@/lib/hooks";
import {
  AUTO_INTERVAL_MS,
  GRADE_COMMENTS,
  GRADE_LABELS,
  METRICS,
  METRIC_KEYS,
  MODE_LABELS,
  SUIT_LABELS,
  USE_CASES,
  condText,
  fetchMeta,
  fmtBytes,
  fmtValue,
  hourlyAverage,
  metricGrade,
  metricScore,
  metricValue,
  overallScore,
  readSettings,
  RESULTS_API,
  fetchSharedResults,
  submitResult,
  userId,
  scoreGrade,
  stability,
  startSpeedTest,
  stats,
  suitability,
  toCsv,
  useSpeedStore,
  type Grade,
  type LiveProgress,
  type MetricKey,
  type RunningTest,
  type SharedResult,
  type SpeedRecord,
  type TestMode,
} from "@/lib/speedtest";

const PHASE_LABELS = { latency: "Ping を測定中", download: "下り (ダウンロード) を測定中", upload: "上り (アップロード) を測定中" };

const RANGES = [
  { key: "24h", label: "24時間", ms: 24 * 3600_000 },
  { key: "7d", label: "7日", ms: 7 * 24 * 3600_000 },
  { key: "30d", label: "30日", ms: 30 * 24 * 3600_000 },
  { key: "all", label: "すべて", ms: Infinity },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const hm = (t: number) => {
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function GradeChip({ grade, label = true }: { grade: Grade; label?: boolean }) {
  return (
    <span className={`grade g-${grade}`}>
      <i />
      <b>{grade}</b>
      {label && <span>{GRADE_LABELS[grade]}</span>}
    </span>
  );
}

export default function SpeedTestPage() {
  const { history, settings, ready, addRecord, clearHistory, updateSettings } = useSpeedStore();
  const [running, setRunning] = useState<{ trigger: "auto" | "manual"; started: number } | null>(null);
  const [live, setLive] = useState<LiveProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const testRef = useRef<RunningTest | null>(null);
  const busy = useRef(false);
  const [sharedKey, setSharedKey] = useState(0);

  // ---- 1 回分の計測 ----
  const run = useCallback(
    async (trigger: "auto" | "manual") => {
      if (busy.current) return;
      busy.current = true;
      const exec = async () => {
        const t = Date.now();
        if (trigger === "auto") updateSettings({ nextAt: t + AUTO_INTERVAL_MS });
        const mode = readSettings().mode;
        setRunning({ trigger, started: t });
        setLive({ phase: null, progress: 0 });
        setMessage(null);
        const test = startSpeedTest(mode, setLive);
        testRef.current = test;
        try {
          const res = await test.promise;
          const meta = await fetchMeta();
          const rec: SpeedRecord = {
            t,
            trigger,
            mode,
            down: res.down,
            up: res.up,
            ping: res.ping,
            jitter: res.jitter,
            downLoaded: res.downLoaded,
            upLoaded: res.upLoaded,
            bytes: res.bytes,
            dur: res.durationMs,
            ...meta,
          };
          addRecord(rec);
          submitResult(rec).then(() => setSharedKey((k) => k + 1));
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            setMessage("計測を中止しました");
          } else {
            const error = e instanceof Error ? e.message : String(e);
            addRecord({ t, trigger, mode, down: null, up: null, ping: null, jitter: null, downLoaded: null, upLoaded: null, bytes: 0, dur: Date.now() - t, error });
            setMessage(`計測に失敗しました（${error}）`);
          }
        } finally {
          testRef.current = null;
          setRunning(null);
          setLive(null);
        }
      };
      try {
        // 複数のタブで同時に計測しない
        if (navigator.locks) {
          await navigator.locks.request("newsdesktop-speedtest", { ifAvailable: true }, async (lock) => {
            if (!lock) {
              if (trigger === "manual") setMessage("別のタブで計測中です");
              return;
            }
            await exec();
          });
        } else {
          await exec();
        }
      } finally {
        busy.current = false;
      }
    },
    [addRecord, updateSettings],
  );

  // ---- 30 分ごとの自動計測 (スリープ復帰・タブ復帰時は予定を過ぎていればすぐ計測) ----
  useEffect(() => {
    if (!ready || !settings.auto) return;
    const tick = () => {
      const s = readSettings();
      if (s.auto && !busy.current && Date.now() >= (s.nextAt ?? 0)) run("auto");
    };
    tick();
    const id = setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ready, settings.auto, run]);

  const toggleAuto = () => updateSettings(settings.auto ? { auto: false, nextAt: null } : { auto: true, nextAt: Date.now() });

  // ---- 期間で絞り込み ----
  const [range, setRange] = useState<RangeKey>("24h");
  const nowMin = useNow(60_000);
  const to = Math.max(nowMin?.getTime() ?? 0, history.at(-1)?.t ?? 0);
  const span = RANGES.find((r) => r.key === range)!.ms;
  const from = Number.isFinite(span) ? to - span : Math.min(history[0]?.t ?? to, to - 24 * 3600_000);
  const inRange = useMemo(() => history.filter((r) => r.t >= from), [history, from]);
  const ok = useMemo(() => inRange.filter((r) => !r.error), [inRange]);
  const latest = useMemo(() => [...history].reverse().find((r) => !r.error) ?? null, [history]);

  return (
    <div className="st-app">
      <header className="topbar">
        <Link href="/" className="nav-btn">
          <Icon name="arrow_back" size={16} /> デスクトップ
        </Link>
        <h1>
          <span className="logo">◆</span> 回線スピードテスト
        </h1>
        {running && (
          <span className="live">
            <span className="dot" /> 計測中
          </span>
        )}
        <span className="topbar-note">計測先: Cloudflare (speed.cloudflare.com)</span>
      </header>

      <main className="st-main">
        <section className="st-top">
          <ControlPanel
            auto={settings.auto}
            nextAt={settings.nextAt}
            mode={settings.mode}
            running={running}
            live={live}
            message={message}
            onToggle={toggleAuto}
            onRun={() => run("manual")}
            onAbort={() => testRef.current?.abort()}
            onMode={(mode) => updateSettings({ mode })}
          />
          <LatestPanel latest={latest} live={running ? live : null} />
        </section>

        {latest && (
          <section className="st-eval">
            <OverallPanel r={latest} />
            <UseCasePanel r={latest} />
          </section>
        )}

        <div className="st-filter" role="group" aria-label="表示期間">
          <span className="st-filter-label">表示期間</span>
          {RANGES.map((r) => (
            <button key={r.key} className={range === r.key ? "on" : ""} aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
          <span className="st-filter-count">
            {ok.length} 回計測{inRange.length > ok.length && `・失敗 ${inRange.length - ok.length} 回`}
          </span>
        </div>

        <PeriodPanel records={ok} all={inRange} latest={latest} />
        <ChartsGrid records={ok} from={from} to={to} />
        <HourlyPanel records={ok} />
        <HistoryPanel records={inRange} onClear={clearHistory} all={history} />

        <AllUsersPanel refreshKey={sharedKey} />

        <footer className="st-notes">
          <p>
            ・自動測定はこのページを開いている間だけ動きます（別のタブに切り替えたり最小化していても計測します）。PC のスリープ中は止まり、復帰したときに予定時刻を過ぎていればすぐに計測します。
          </p>
          <p>・計測は Cloudflare の最寄りのデータセンターとの間で行います。他のタブで動画を再生していると結果が低く出ます。</p>
          <p>
            ・評価は目安です。下り・上り・Ping・ジッター・負荷時の遅延増加をそれぞれ 0〜100 点に換算し、重み（下り 30%・上り 20%・Ping 20%・ジッター 15%・遅延増加 15%）を付けて平均しています。
          </p>
          <p>
            ・履歴はこのブラウザ（localStorage）に保存されます。{RESULTS_API ? "計測が成功すると、速度値・接続先・ISP 名・匿名 ID（IP アドレスは含みません）を共有サーバーに送信し、下の「全ユーザーの計測結果」に公開されます。" : "外部には送信しません。"}
          </p>
        </footer>
      </main>
    </div>
  );
}

// ---- 操作パネル ----

function ControlPanel({
  auto,
  nextAt,
  mode,
  running,
  live,
  message,
  onToggle,
  onRun,
  onAbort,
  onMode,
}: {
  auto: boolean;
  nextAt: number | null;
  mode: TestMode;
  running: { trigger: "auto" | "manual"; started: number } | null;
  live: LiveProgress | null;
  message: string | null;
  onToggle: () => void;
  onRun: () => void;
  onAbort: () => void;
  onMode: (m: TestMode) => void;
}) {
  const now = useNow(1000)?.getTime() ?? 0;
  return (
    <section className="panel st-control">
      <header className="panel-head">
        <h2>自動測定</h2>
        <span className="panel-sub">30 分ごと</span>
      </header>
      <div className="panel-body">
        <button className={`switch ${auto ? "on" : ""}`} role="switch" aria-checked={auto} onClick={onToggle}>
          <span className="switch-track">
            <span className="switch-thumb" />
          </span>
          <span className="switch-label">{auto ? "オン" : "オフ"}</span>
        </button>
        <p className="st-status">
          {running ? (
            <>
              {running.trigger === "auto" ? "自動" : "手動"}計測中… {mmss(now - running.started)} 経過
            </>
          ) : auto && nextAt ? (
            <>
              次回 <b>{hm(Math.max(nextAt, now))}</b>
              {nextAt > now && <span className="muted">（あと {mmss(nextAt - now)}）</span>}
            </>
          ) : (
            <span className="muted">オンにするとすぐに 1 回目を計測し、以降 30 分ごとに計測します</span>
          )}
        </p>

        {running && live && (
          <div className="st-progress">
            <div className="st-progress-label">{live.phase ? PHASE_LABELS[live.phase] : "準備中"}</div>
            <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(live.progress * 100)}>
              <i style={{ width: `${Math.max(3, live.progress * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="st-actions">
          {running ? (
            <button className="btn" onClick={onAbort}>
              <Icon name="stop" size={16} /> 中止
            </button>
          ) : (
            <button className="btn primary" onClick={onRun}>
              <Icon name="speed" size={16} /> 今すぐ測定
            </button>
          )}
        </div>
        {message && <p className="st-message">{message}</p>}

        <label className="st-mode">
          <span>計測モード</span>
          <select value={mode} disabled={!!running} onChange={(e) => onMode(e.target.value as TestMode)}>
            {(Object.keys(MODE_LABELS) as TestMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m].name}
              </option>
            ))}
          </select>
        </label>
        <p className="st-mode-note">{MODE_LABELS[mode].note}</p>
      </div>
    </section>
  );
}

// ---- 最新の結果 ----

function LatestPanel({ latest, live }: { latest: SpeedRecord | null; live: LiveProgress | null }) {
  const values: Record<MetricKey, number | null | undefined> = live
    ? { down: live.down, up: live.up, ping: live.ping, jitter: live.jitter, bloat: undefined }
    : {
        down: latest?.down,
        up: latest?.up,
        ping: latest?.ping,
        jitter: latest?.jitter,
        bloat: latest ? metricValue(latest, "bloat") : null,
      };
  return (
    <section className="panel st-latest">
      <header className="panel-head">
        <h2>{live ? "計測中の値" : "最新の結果"}</h2>
        {!live && latest && (
          <span className="panel-sub">
            {fmtTime(latest.t)}
            {latest.colo && ` ・ 接続先 ${latest.colo}`}
            {latest.isp && ` ・ ${latest.isp}`}
          </span>
        )}
      </header>
      <div className={`panel-body st-tiles ${live ? "is-live" : ""}`}>
        {METRIC_KEYS.map((k) => {
          const v = values[k];
          const def = METRICS[k];
          return (
            <div key={k} className={`tile tile-${k}`}>
              <div className="tile-label">
                {k === "down" && "↓ "}
                {k === "up" && "↑ "}
                {def.label}
              </div>
              <div className="tile-value">
                {fmtValue(v, def.unit)}
                <small>{def.unit}</small>
              </div>
              <div className="tile-foot">
                {!live && v !== null && v !== undefined ? <GradeChip grade={metricGrade(k, v)} /> : <span className="muted">{live ? "測定中" : "—"}</span>}
              </div>
              <div className="tile-desc">{def.desc}</div>
            </div>
          );
        })}
        {!latest && !live && <p className="st-empty">まだ計測結果がありません。「今すぐ測定」または自動測定をオンにしてください。</p>}
      </div>
    </section>
  );
}

// ---- 評価 ----

function OverallPanel({ r }: { r: SpeedRecord }) {
  const score = overallScore(r);
  if (score === null) return null;
  const grade = scoreGrade(score);
  const scored = METRIC_KEYS.map((k) => {
    const v = metricValue(r, k);
    return { k, v, s: v === null ? null : metricScore(k, v) };
  });
  const weakest = scored.filter((x) => x.s !== null).sort((a, b) => (a.s as number) - (b.s as number))[0];
  return (
    <section className="panel st-overall">
      <header className="panel-head">
        <h2>総合評価</h2>
        <span className="panel-sub">最新の結果より</span>
      </header>
      <div className="panel-body">
        <div className="st-score">
          <div className="st-score-num">
            {Math.round(score)}
            <small>/ 100</small>
          </div>
          <GradeChip grade={grade} />
        </div>
        <p className="st-comment">
          {GRADE_COMMENTS[grade]}
          {weakest && weakest.s !== null && weakest.s < 60 && (
            <>
              {" "}
              特に<b>{METRICS[weakest.k].label}</b>が弱点です。
            </>
          )}
        </p>
        <ul className="st-meters">
          {scored.map(({ k, v, s }) => (
            <li key={k}>
              <span className="st-meter-label">{METRICS[k].label}</span>
              <span className={`meter g-${s === null ? "none" : metricGrade(k, v as number)}`}>
                <i style={{ width: `${s ?? 0}%` }} />
              </span>
              <span className="st-meter-val">{s === null ? "—" : `${Math.round(s)}点`}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function UseCasePanel({ r }: { r: SpeedRecord }) {
  return (
    <section className="panel st-usecase">
      <header className="panel-head">
        <h2>用途別の評価</h2>
        <span className="panel-sub">○ の目安を併記</span>
      </header>
      <div className="panel-body">
        <ul className="usecases">
          {USE_CASES.map((uc) => {
            const lv = suitability(uc, r);
            return (
              <li key={uc.name}>
                <span className={`suit s-${lv}`}>
                  <b>{SUIT_LABELS[lv].mark}</b> {SUIT_LABELS[lv].text}
                </span>
                <span className="uc-name">{uc.name}</span>
                <span className="uc-need">{condText(uc.tiers[1])}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ---- 期間の統計と評価 ----

const ROWS: { key: MetricKey | "score"; label: string; unit: "Mbps" | "ms" | "score" }[] = [
  ...METRIC_KEYS.map((k) => ({ key: k, label: METRICS[k].label, unit: METRICS[k].unit })),
  { key: "score", label: "総合スコア", unit: "score" },
];

const valueOf = (r: SpeedRecord, key: MetricKey | "score") => (key === "score" ? overallScore(r) : metricValue(r, key));

function PeriodPanel({ records, all, latest }: { records: SpeedRecord[]; all: SpeedRecord[]; latest: SpeedRecord | null }) {
  const table = ROWS.map((row) => ({ ...row, st: stats(records.map((r) => valueOf(r, row.key)).filter((v): v is number => v !== null)) }));
  const scoreSt = table.find((t) => t.key === "score")!.st;
  const downSt = table.find((t) => t.key === "down")!.st;

  const insights: { text: React.ReactNode; level?: "good" | "warn" | "bad" }[] = [];
  if (scoreSt) {
    const g = scoreGrade(scoreSt.avg);
    insights.push({ text: <>期間の平均スコアは <b>{Math.round(scoreSt.avg)} 点</b>（{g}・{GRADE_LABELS[g]}）</> });
  }
  if (downSt && downSt.n >= 3) {
    const sl = stability("down", downSt);
    insights.push({
      level: sl.level,
      text: (
        <>
          下り速度は<b>{sl.text}</b>（変動係数 {(downSt.cv * 100).toFixed(0)}%・最小 {fmtValue(downSt.min, "Mbps")} 〜 最大 {fmtValue(downSt.max, "Mbps")} Mbps）
        </>
      ),
    });
  }
  const hourly = hourlyAverage(records, "down");
  const hours = hourly.map((v, h) => ({ v, h })).filter((x): x is { v: number; h: number } => x.v !== null);
  if (hours.length >= 4) {
    const slow = hours.reduce((a, b) => (b.v < a.v ? b : a));
    const fast = hours.reduce((a, b) => (b.v > a.v ? b : a));
    const ratio = slow.v / fast.v;
    insights.push({
      level: ratio < 0.5 ? "bad" : ratio < 0.8 ? "warn" : "good",
      text: (
        <>
          下りが最も遅い時間帯は <b>{slow.h}時台</b>（平均 {fmtValue(slow.v, "Mbps")} Mbps）で、最も速い {fast.h}時台の {(ratio * 100).toFixed(0)}%
          {ratio < 0.8 ? "。混雑時間帯に速度が落ちています" : "。時間帯による差は小さめです"}
        </>
      ),
    });
  }
  if (latest && downSt && downSt.n >= 3 && latest.down !== null) {
    const diff = latest.down / downSt.avg - 1;
    insights.push({
      level: diff < -0.3 ? "warn" : undefined,
      text: (
        <>
          最新の下りは期間平均より <b>{Math.abs(diff * 100).toFixed(0)}% {diff >= 0 ? "速い" : "遅い"}</b>
        </>
      ),
    });
  }
  const failed = all.length - records.length;
  if (failed) insights.push({ level: failed / all.length > 0.1 ? "bad" : "warn", text: <>計測に {failed} 回失敗しています（回線断や接続先の障害の可能性）</> });
  const bytes = records.reduce((s, r) => s + r.bytes, 0);
  if (records.length) {
    insights.push({
      text: (
        <>
          計測に使ったデータ量は計 {fmtBytes(bytes)}（1 回平均 {fmtBytes(bytes / records.length)}、30 分ごとなら 1 日 約 {fmtBytes((bytes / records.length) * 48)}）
        </>
      ),
    });
  }

  return (
    <section className="st-period">
      <section className="panel">
        <header className="panel-head">
          <h2>期間の統計</h2>
        </header>
        <div className="panel-body st-scroll">
          <table className="st-table">
            <thead>
              <tr>
                <th>項目</th>
                <th>平均</th>
                <th>中央値</th>
                <th>最小</th>
                <th>最大</th>
                <th>ばらつき</th>
              </tr>
            </thead>
            <tbody>
              {table.map(({ key, label, unit, st }) => (
                <tr key={key}>
                  <th>
                    {label}
                    <small>{unit === "score" ? "点" : unit}</small>
                  </th>
                  <td>{fmtValue(st?.avg, unit)}</td>
                  <td>{fmtValue(st?.median, unit)}</td>
                  <td>{fmtValue(st?.min, unit)}</td>
                  <td>{fmtValue(st?.max, unit)}</td>
                  <td>{st && st.n >= 3 ? <span className={`lvl lvl-${stability(key, st).level}`}>{stability(key, st).text}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <header className="panel-head">
          <h2>期間の評価</h2>
        </header>
        <div className="panel-body">
          {insights.length ? (
            <ul className="insights">
              {insights.map((it, i) => (
                <li key={i} className={it.level ? `lvl-${it.level}` : ""}>
                  {it.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="st-empty">この期間の計測データはありません</p>
          )}
        </div>
      </section>
    </section>
  );
}

// ---- グラフ ----

function ChartsGrid({ records, from, to }: { records: SpeedRecord[]; from: number; to: number }) {
  const times = useMemo(() => records.map((r) => r.t), [records]);
  const single = (key: MetricKey | "score"): Series[] => [
    { label: key === "score" ? "総合スコア" : METRICS[key].label, color: "var(--series-1)", values: records.map((r) => valueOf(r, key)) },
  ];
  const gapMs = AUTO_INTERVAL_MS * 2.2;
  const charts: { title: string; sub: string; unit: string; series: Series[]; fmt: (v: number) => string; yMax?: number }[] = [
    { title: "下り（ダウンロード）", sub: "Mbps", unit: "Mbps", series: single("down"), fmt: (v) => fmtValue(v, "Mbps") },
    { title: "上り（アップロード）", sub: "Mbps", unit: "Mbps", series: single("up"), fmt: (v) => fmtValue(v, "Mbps") },
    { title: "Ping", sub: "ms・無負荷時", unit: "ms", series: single("ping"), fmt: (v) => fmtValue(v, "ms") },
    { title: "ジッター", sub: "ms", unit: "ms", series: single("jitter"), fmt: (v) => fmtValue(v, "ms") },
    {
      title: "負荷時の Ping",
      sub: "ms・通信中の遅延",
      unit: "ms",
      series: [
        { label: "下り通信中", color: "var(--series-1)", values: records.map((r) => r.downLoaded) },
        { label: "上り通信中", color: "var(--series-2)", values: records.map((r) => r.upLoaded) },
      ],
      fmt: (v) => fmtValue(v, "ms"),
    },
    { title: "総合スコア", sub: "0〜100 点", unit: "点", series: single("score"), fmt: (v) => fmtValue(v, "score"), yMax: 100 },
  ];
  return (
    <section className="st-charts">
      {charts.map((c) => (
        <section key={c.title} className="panel">
          <header className="panel-head">
            <h2>{c.title}</h2>
            <span className="panel-sub">{c.sub}</span>
            {c.series.length > 1 && (
              <span className="legend">
                {c.series.map((s) => (
                  <span key={s.label}>
                    <i style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </span>
            )}
          </header>
          <div className="panel-body chart-body">
            <LineChart times={times} series={c.series} from={from} to={to} gapMs={gapMs} fmt={c.fmt} unit={c.unit} yMax={c.yMax} />
          </div>
        </section>
      ))}
    </section>
  );
}

function HourlyPanel({ records }: { records: SpeedRecord[] }) {
  const [key, setKey] = useState<MetricKey>("down");
  const values = useMemo(() => hourlyAverage(records, key), [records, key]);
  const def = METRICS[key];
  return (
    <section className="panel st-hourly">
      <header className="panel-head">
        <h2>時間帯別の平均</h2>
        <span className="panel-sub">混雑しやすい時間帯の確認に</span>
        <span className="seg" role="group" aria-label="表示する項目">
          {(["down", "up", "ping", "jitter"] as MetricKey[]).map((k) => (
            <button key={k} className={key === k ? "on" : ""} aria-pressed={key === k} onClick={() => setKey(k)}>
              {METRICS[k].label}
            </button>
          ))}
        </span>
      </header>
      <div className="panel-body chart-body">
        <HourBars values={values} fmt={(v) => fmtValue(v, def.unit)} unit={def.unit} color="var(--series-1)" />
      </div>
    </section>
  );
}

// ---- 履歴 ----

function HistoryPanel({ records, all, onClear }: { records: SpeedRecord[]; all: SpeedRecord[]; onClear: () => void }) {
  const [limit, setLimit] = useState(20);
  const rows = useMemo(() => [...records].reverse(), [records]);
  const download = () => {
    const blob = new Blob([toCsv(all)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `speedtest-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <section className="panel st-history">
      <header className="panel-head">
        <h2>計測履歴</h2>
        <span className="panel-sub">{records.length} 件</span>
        <span className="panel-status">
          <button className="btn small" onClick={download} disabled={!all.length}>
            <Icon name="file_download" size={16} /> CSV
          </button>
          <button className="btn small" onClick={() => confirm("計測履歴をすべて削除しますか？") && onClear()} disabled={!all.length}>
            <Icon name="delete" size={16} /> 全削除
          </button>
        </span>
      </header>
      <div className="panel-body">
        {rows.length ? (
          <div className="st-scroll">
            <table className="st-table st-log">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>下り</th>
                  <th>上り</th>
                  <th>Ping</th>
                  <th>ジッター</th>
                  <th>遅延増加</th>
                  <th>評価</th>
                  <th>データ量</th>
                  <th>接続先</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r) => {
                  const score = overallScore(r);
                  return (
                    <tr key={r.t}>
                      <th>
                        {fmtTime(r.t)}
                        <small>{r.trigger === "auto" ? "自動" : "手動"}</small>
                      </th>
                      {r.error ? (
                        <td colSpan={8} className="err">
                          計測失敗: {r.error}
                        </td>
                      ) : (
                        <>
                          <td>{fmtValue(r.down, "Mbps")}</td>
                          <td>{fmtValue(r.up, "Mbps")}</td>
                          <td>{fmtValue(r.ping, "ms")}</td>
                          <td>{fmtValue(r.jitter, "ms")}</td>
                          <td>{fmtValue(metricValue(r, "bloat"), "ms")}</td>
                          <td>{score === null ? "—" : <><GradeChip grade={scoreGrade(score)} label={false} /> {Math.round(score)}</>}</td>
                          <td>{fmtBytes(r.bytes)}</td>
                          <td className="muted">{r.colo ?? "—"}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > limit && (
              <button className="btn small more" onClick={() => setLimit((l) => l + 50)}>
                さらに表示（残り {rows.length - limit} 件）
              </button>
            )}
          </div>
        ) : (
          <p className="st-empty">この期間の計測データはありません</p>
        )}
      </div>
    </section>
  );
}

// ---- 全ユーザーの結果 ----

function AllUsersPanel({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<SharedResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [me, setMe] = useState("");

  useEffect(() => setMe(userId()), []);
  useEffect(() => {
    if (!RESULTS_API) return;
    let alive = true;
    fetchSharedResults()
      .then((r) => alive && (setRows(r), setError(null)))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const users = useMemo(() => new Set(rows?.map((r) => r.uid)).size, [rows]);
  return (
    <section className="panel st-history">
      <header className="panel-head">
        <h2>全ユーザーの計測結果</h2>
        <span className="panel-sub">{rows ? `${rows.length} 件・${users} ユーザー（新しい順）` : "共有サーバーの結果"}</span>
      </header>
      <div className="panel-body">
        {!RESULTS_API ? (
          <p className="st-empty">共有サーバーが未設定です（NEXT_PUBLIC_SPEEDTEST_API）。設定方法は README を参照してください。</p>
        ) : error ? (
          <p className="st-empty">結果を取得できませんでした（{error}）</p>
        ) : !rows ? (
          <p className="st-empty">読み込み中…</p>
        ) : !rows.length ? (
          <p className="st-empty">まだ共有された計測結果がありません</p>
        ) : (
          <div className="st-scroll">
            <table className="st-table st-log">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>ユーザー</th>
                  <th>下り</th>
                  <th>上り</th>
                  <th>Ping</th>
                  <th>ジッター</th>
                  <th>遅延増加</th>
                  <th>評価</th>
                  <th>モード</th>
                  <th>データ量</th>
                  <th>接続先</th>
                  <th>ISP</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r) => {
                  const score = overallScore(r);
                  return (
                    <tr key={`${r.uid}-${r.t}`}>
                      <th>
                        {fmtTime(r.t)}
                        <small>{r.trigger === "auto" ? "自動" : "手動"}</small>
                      </th>
                      <td>
                        #{r.uid.slice(0, 6)}
                        {r.uid === me && <small> (あなた)</small>}
                      </td>
                      <td>{fmtValue(r.down, "Mbps")}</td>
                      <td>{fmtValue(r.up, "Mbps")}</td>
                      <td>{fmtValue(r.ping, "ms")}</td>
                      <td>{fmtValue(r.jitter, "ms")}</td>
                      <td>{fmtValue(metricValue(r, "bloat"), "ms")}</td>
                      <td>{score === null ? "—" : <><GradeChip grade={scoreGrade(score)} label={false} /> {Math.round(score)}</>}</td>
                      <td>{MODE_LABELS[r.mode]?.name ?? "—"}</td>
                      <td>{fmtBytes(r.bytes)}</td>
                      <td className="muted">{r.colo ?? "—"}</td>
                      <td className="muted">{r.isp ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > limit && (
              <button className="btn small more" onClick={() => setLimit((l) => l + 50)}>
                さらに表示（残り {rows.length - limit} 件）
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
