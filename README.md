# News Desktop

PC の 1 画面に収まる、パーソナル情報のリアルタイムダッシュボード（Next.js / React）。

![画面構成](docs/layout-dark.png)

## 表示内容と更新間隔

| エリア | 内容 | データソース | 更新 |
|---|---|---|---|
| 左上 | 日本標準時（和暦・世界時計付き）＋同期精度 | [NICT](https://jjy.nict.go.jp/) の時刻と端末時計のずれを補正（失敗時 Akamai → HTTP Date） | 表示: 毎秒 / 同期: 60 秒 |
| 左下 | 現在地の現在の天気・時間予報・週間予報 | [Open-Meteo](https://open-meteo.com/)（位置情報 → [BigDataCloud](https://www.bigdatacloud.com/) で地名化） | 5 分 |
| 中央上 | 国内ニュース | Yahoo!ニュース RSS（国内・経済トピックス、国内カテゴリ） | 取得 5 分 / 画面 2 分 |
| 中央下 | 現在地周辺のニュース | Yahoo!ニュース「地域」を都道府県名で抽出 + Google News 検索（都道府県名・市区町村名） | 取得 20 分 / 画面 5 分 |
| 右上 | 日経平均株価 / TOPIX（当日チャート・東証の立会状況） | Yahoo Finance（失敗時 stooq） | 取得 5 分 / 画面 1 分 |
| 右下 | 国際ニュース | Yahoo!ニュース RSS（国際トピックス、国際カテゴリ） | 取得 5 分 / 画面 2 分 |
| 下部 | 速報テロップ | 国内・国際の直近 1 時間のニュース | ニュースと同時 |

- 時計は NTP と同じ方式（往復遅延の中点）で NICT との時刻差を求めて補正し、
  「誤差 ±x.xx秒」（= 往復遅延/2 + 時刻分解能 + 表示遅延）、端末時計のずれ、通信遅延（RTT）、
  ジッター（直近 8 回の計測のばらつき）、表示遅延をリアルタイムで表示します。
- **速報通知**: Yahoo!ニュース主要トピックスの新着と「速報」「緊急」「津波」などを含む見出しを検出すると、
  通知音（ブラウザ内で合成したチャイム）とポップアップで知らせます。ヘッダーの「🔔 速報通知」から
  通知音・音量・ポップアップ・デスクトップ通知（別タブ表示中）を切り替え、テスト通知も鳴らせます。
  ブラウザの自動再生制限のため、音はページを一度クリックした後から鳴ります。
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

### ニュース・株価データの取得方法

GitHub Pages は静的ホスティングのため、ブラウザから直接取得できない（CORS 非対応の）
Yahoo!ニュース / Google News の RSS と株価は、`.github/workflows/collect.yml` が **5 分ごと**に
GitHub Actions 上で取得し、`data` ブランチに JSON として保存します（`scripts/collect.mjs`）。
ダッシュボードはその JSON を `raw.githubusercontent.com` から読み込みます。

- 地域ニュースは 47 都道府県分を 20 分ごとに取得し、現在地の都道府県のものを表示します。
- GitHub の定期実行は混雑時に数分〜十数分遅れることがあります。
- データが 30 分以上古い場合は、公開 CORS プロキシ経由での直接取得も試みます。
  自前のプロキシ（`proxy/cloudflare-worker.js`）を使う場合はリポジトリ変数
  `CORS_PROXY = https://<worker>.workers.dev/?url=` を設定してください。

## 注意

- 株価は無料データソースのため遅延を含む場合があります。東証の祝日は立会状況表示に反映していません。
- ニュースの著作権は各配信元に帰属します。見出しとリンクのみを表示しています。
