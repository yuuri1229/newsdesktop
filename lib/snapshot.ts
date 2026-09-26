// GitHub Actions (scripts/collect.mjs) が data ブランチに保存した JSON を読む。
// raw.githubusercontent.com は CORS を許可しているのでブラウザから直接取得できる。
import { fetchJson } from "./fetcher";

const BASE = process.env.NEXT_PUBLIC_DATA_BASE || "https://raw.githubusercontent.com/yuuri1229/newsdesktop/data";

/** これより古いスナップショットはプロキシ経由の直接取得を試す */
export const STALE_MS = 30 * 60 * 1000;

export type Snap<T> = { data: T; asOf: Date };

export async function fetchSnapshot<T>(file: string): Promise<Snap<T>> {
  const json = await fetchJson<{ updatedAt: string; data: T }>(`${BASE}/${file}?t=${Date.now()}`);
  return { data: json.data, asOf: new Date(json.updatedAt) };
}

export const isFresh = (s: Snap<unknown>) => Date.now() - s.asOf.getTime() < STALE_MS;

/** スナップショットが新しければそれを、古い/無ければ直接取得を、両方ダメなら古いスナップショットを返す */
export async function snapshotOr<T>(file: string, direct: () => Promise<T>, revive: (raw: T) => T = (x) => x): Promise<Snap<T>> {
  let snap: Snap<T> | null = null;
  try {
    const s = await fetchSnapshot<T>(file);
    snap = { data: revive(s.data), asOf: s.asOf };
    if (isFresh(snap)) return snap;
  } catch {}
  try {
    return { data: await direct(), asOf: new Date() };
  } catch (e) {
    if (snap) return snap;
    throw e;
  }
}
