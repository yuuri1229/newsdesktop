import type { ReactNode } from "react";

const hhmm = (d: Date) =>
  d.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function Panel({
  title,
  sub,
  updatedAt,
  error,
  loading,
  onRefresh,
  className = "",
  children,
}: {
  title: string;
  sub?: ReactNode;
  updatedAt?: Date | null;
  error?: string | null;
  loading?: boolean;
  onRefresh?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {sub && <span className="panel-sub">{sub}</span>}
        <span className="panel-status">
          {error && <span className="err" title={error}>⚠ 取得失敗</span>}
          {updatedAt && <span>{hhmm(updatedAt)} 更新</span>}
          {onRefresh && (
            <button className={`refresh ${loading ? "spin" : ""}`} onClick={onRefresh} aria-label={`${title}を更新`}>
              ↻
            </button>
          )}
        </span>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Empty({ error, loading }: { error?: string | null; loading?: boolean }) {
  return <div className="empty">{error ? `データを取得できませんでした（${error}）` : loading ? "読み込み中…" : "データなし"}</div>;
}
