// 全ユーザーのスピードテスト結果を集める Cloudflare Worker (無料枠で動作)。
// 1) KV 名前空間を作成し、この Worker に変数名 RESULTS でバインドする。
// 2) デプロイ後、GitHub リポジトリ変数 SPEEDTEST_API に Worker の URL
//    (例: https://speedtest-results.<account>.workers.dev) を設定する。
// 保存するのは速度値・接続先・ISP 名・匿名ユーザー ID のみ (IP アドレスは保存しない)。
const MAX_LIST = 500;
const TTL = 60 * 60 * 24 * 90; // 90 日で自動削除
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });

const num = (v, max) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : null);
const str = (v, n) => (typeof v === "string" && v ? v.slice(0, n) : undefined);

function clean(b) {
  if (!b || typeof b !== "object") return null;
  const t = Number(b.t);
  const uid = str(b.uid, 36);
  if (!uid || !Number.isFinite(t) || Math.abs(Date.now() - t) > 24 * 3600_000) return null;
  const mode = ["light", "standard", "precise"].includes(b.mode) ? b.mode : "standard";
  return {
    t,
    uid,
    trigger: b.trigger === "auto" ? "auto" : "manual",
    mode,
    down: num(b.down, 1e6),
    up: num(b.up, 1e6),
    ping: num(b.ping, 1e5),
    jitter: num(b.jitter, 1e5),
    downLoaded: num(b.downLoaded, 1e5),
    upLoaded: num(b.upLoaded, 1e5),
    bytes: num(b.bytes, 1e11) ?? 0,
    colo: str(b.colo, 60),
    isp: str(b.isp, 80),
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (request.method === "POST") {
      let rec;
      try {
        rec = clean(await request.json());
      } catch {}
      if (!rec || rec.down === null) return json({ error: "invalid" }, 400);
      // キーは新しい順に並ぶよう時刻を反転する。メタデータに本体を入れて list 1 回で取得できるようにする。
      const key = `r:${String(9e15 - rec.t).padStart(16, "0")}:${rec.uid}`;
      await env.RESULTS.put(key, "1", { metadata: rec, expirationTtl: TTL });
      return json({ ok: true });
    }

    if (request.method === "GET") {
      const limit = Math.min(Number(new URL(request.url).searchParams.get("limit")) || 200, MAX_LIST);
      const res = await env.RESULTS.list({ prefix: "r:", limit });
      return json({ results: res.keys.map((k) => k.metadata).filter(Boolean) });
    }

    return json({ error: "method not allowed" }, 405);
  },
};
