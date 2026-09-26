// 任意: 公開 CORS プロキシが不安定な場合に使う自前プロキシ (Cloudflare Workers 無料枠で動作)。
// デプロイ後、GitHub リポジトリ変数 CORS_PROXY に "https://<name>.<account>.workers.dev/?url=" を設定する。
const ALLOW = ["www3.nhk.or.jp", "news.google.com", "query1.finance.yahoo.com", "stooq.com"];

export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("missing url", { status: 400 });
    const host = new URL(target).hostname;
    if (!ALLOW.includes(host)) return new Response("forbidden host", { status: 403 });
    const res = await fetch(target, {
      headers: { "user-agent": "Mozilla/5.0 (newsdesktop proxy)" },
      cf: { cacheTtl: 30 },
    });
    const headers = new Headers(res.headers);
    headers.set("access-control-allow-origin", "*");
    return new Response(res.body, { status: res.status, headers });
  },
};
