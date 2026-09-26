# News Desktop

PC の 1 画面に収まる、パーソナル情報のリアルタイムダッシュボード（Next.js / React）。

![画面構成](docs/layout-dark.png)

## 表示内容と更新間隔

| エリア | 内容 | データソース | 更新 |
|---|---|---|---|
| 左上 | 日本標準時（和暦・世界時計付き） | 端末時計を `Asia/Tokyo` で表示 | 0.25 秒 |
| 左下 | 現在地の現在の天気・時間予報・週間予報 | [Open-Meteo](https://open-meteo.com/)（位置情報 → [BigDataCloud](https://www.bigdatacloud.com/) で地名化） | 5 分 |
| 中央上 | 国内ニュース | NHK RSS（主要・社会・政治）+ Google News 国内 | 2 分 |
| 中央下 | 現在地周辺のニュース | Google News 検索（市区町村名 / 都道府県名、24 時間以内） | 5 分 |
| 右上 | 日経平均株価 / TOPIX（当日チャート・東証の立会状況） | Yahoo Finance（失敗時 stooq） | 1 分 |
| 右下 | 国際ニュース | NHK RSS（国際）+ Google News 国際 | 2 分 |
| 下部 | 速報テロップ | 国内・国際の直近 1 時間のニュース | ニュースと同時 |

- 1 時間以内の記事には `NEW` バッジが付きます。
- タブを再表示したときにも即時更新します。各パネルの ↻ で手動更新も可能です。
- 位置情報を許可しない場合は前回の位置、なければ東京（千代田区）を使います。
- 幅 1100px 未満（タブレット・スマホ）では 1 カラムの縦スクロール表示になります。

## 開発

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # 静的ファイルを out/ に出力
```

## GitHub Pages へのデプロイ

`.github/workflows/deploy.yml` が push のたびにビルドして GitHub Pages に公開します。

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする（初回のみ）
2. `main`（または作業ブランチ）に push、もしくは Actions タブから `Deploy to GitHub Pages` を手動実行
3. `https://<ユーザー名>.github.io/newsdesktop/` で表示

> Pages の `github-pages` 環境は既定でデフォルトブランチからのデプロイのみ許可されます。
> 別ブランチから公開する場合は Settings → Environments → github-pages で許可ブランチを追加してください。

### CORS プロキシについて

GitHub Pages は静的ホスティングのため、CORS 非対応の RSS / 株価 API は公開 CORS プロキシ
（allorigins / corsproxy.io / codetabs）を順に試して取得します。安定運用したい場合は
`proxy/cloudflare-worker.js` を Cloudflare Workers にデプロイし、リポジトリの
**Settings → Secrets and variables → Actions → Variables** に
`CORS_PROXY = https://<worker>.workers.dev/?url=` を追加してください。

## 注意

- 株価は無料データソースのため遅延を含む場合があります。東証の祝日は立会状況表示に反映していません。
- ニュースの著作権は各配信元に帰属します。見出しとリンクのみを表示しています。
