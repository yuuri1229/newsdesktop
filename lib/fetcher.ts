// ブラウザから直接取得できない (CORS 非対応の) フィードを取得するためのヘルパー。
// 静的ホスティング (GitHub Pages) ではサーバーを持てないため、公開 CORS プロキシを
// 順番に試し、成功したものを次回以降優先する。独自プロキシを使う場合は
// NEXT_PUBLIC_CORS_PROXY に "https://example.workers.dev/?url=" のように設定する。

type ProxyFn = (url: string) => string;

const customProxy = process.env.NEXT_PUBLIC_CORS_PROXY;

const PROXIES: ProxyFn[] = [
  ...(customProxy ? [(u: string) => customProxy + encodeURIComponent(u)] : []),
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];

let preferred = 0;

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/** CORS 対応 API を直接取得する */
export async function fetchJson<T>(url: string, timeoutMs = 10000): Promise<T> {
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** CORS 非対応のリソースをプロキシ経由で取得する */
export async function fetchViaProxy(url: string, timeoutMs = 12000): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < PROXIES.length; i++) {
    const idx = (preferred + i) % PROXIES.length;
    try {
      const res = await fetchWithTimeout(PROXIES[idx](url), timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("empty response");
      preferred = idx;
      return text;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetch failed");
}
