# CLAUDE.md — フォワーダー支援統合プロジェクト

このディレクトリは、フォワーディング業務向けの Vanilla JS フロントエンドアプリ群を集約・統合する作業ディレクトリ。

## 構成（2026-05-17 / Phase 2c 全 Step 完了時点）

```
github/202605_コード改修/
├── フォワーダー支援/          ← 統合ポータル本体（旧「実務支援」由来）
│   ├── index.html             ポータル本体（カテゴリ:🧮計算/🚢本船・航路/💴料金・費用/💼見積/📄書類・通関/📚知識・参考/📋Booking-SI）
│   ├── landing.html           入口ページ（外部からの導線）
│   ├── portal.html            index.html へのリダイレクト
│   ├── css/
│   │   ├── style.css          ポータル全体スタイル
│   │   └── quote.css          見積タブ専用（#tab-quote-make スコープ）
│   ├── data/{carriers,incoterms}.js   船会社17社・インコタームズ11件
│   ├── js/
│   │   ├── app.js             ポータルロジック（タブ切替・トースト等）
│   │   ├── calculator.js      計算ツール各種
│   │   └── quote/             見積タブ用（旧 見積支援/app-*.js を移植）
│   │       ├── constants.js   グローバル定数・通貨・カテゴリ・FX
│   │       ├── row.js         行追加/削除/ドラッグ並び替え/↑↓キー移動
│   │       ├── preview.js     プレビュー・CSV/Excel/PDF 出力
│   │       ├── cargo.js       貨物情報・CBM/CW 計算
│   │       ├── conditions.js  引き合い条件・ゾーンビルダー・自動保存
│   │       ├── save.js        プリセット保存・読込・フィードバックモーダル
│   │       └── ui.js          UI・付箋・Ctrl+K・FX パネル・initQuoteTab()
│   └── shared/                両アプリで共有する 5 モジュール（IIFE で window 名前空間）
│       ├── fx.js              SharedFX: open.er-api.com 為替・1h メモリキャッシュ
│       ├── format.js          SharedFmt: num/escapeHtml/escapeCsv
│       ├── storage.js         SharedStorage: KEYS 列挙＋getJSON/setJSON
│       ├── ui-utils.js        SharedUI: copyToClipboard/showToast
│       └── calc.js            SharedCalc: CBM/CW/RT/コンテナ目安など純粋関数
└── 見積支援/                  ← 単体起動用（読み取り専用、保険として残置）
    ├── README.md              「ポータル側を編集してください」明記
    ├── index.html             単体起動可。../フォワーダー支援/shared/ を参照
    ├── app-*.js / style.css   ポータル側 js/quote/ と内容ほぼ同一
    └── *.bak ...              手動バックアップ群（運用上残置）
```

## 統合の現状

**完了**
- Phase 1：重複していた為替・localStorage キー・フォーマット・計算関数を `フォワーダー支援/shared/` に集約
- Phase 2a：iframe で 見積支援/ を埋め込んで暫定統合
- Phase 2b（2026-05-17）：iframe を撤去し、見積支援の DOM/CSS/JS をポータルに**直接マージ**
  - `フォワーダー支援/css/quote.css` 2598 行（`#tab-quote-make` スコープ）
  - `フォワーダー支援/js/quote/*.js` 7 本（`showToast` → `quoteShowToast` リネーム、DOMContentLoaded → `initQuoteTab()` 集約）
  - SheetJS は `<head>` で defer 読み込み
  - `js/app.js:switchTab()` に `if (tabId === 'quote-make') window.initQuoteTab()` フックを追加
- Phase 2c-Step1（2026-05-17）：**フィードバック FAB 統合**。見積タブ内 `.fb-fab`/`#fbOverlay`/`#toast-container` を `</body>` 直前へ移動しサイト全体スコープに昇格。ポータル zombie `.feedback-fab` + 独自モーダル HTML/CSS（`index.html:2332-2386`、`css/style.css:773-939`）削除。`js/calculator.js:749-798` の dead `postToGoogleForm`/`sendFeedback`/旧 Google Form ID 削除。`css/quote.css:1471-1644` の `#tab-quote-make .fb-*` プレフィックス全削除（デスコープ）
- Phase 2c-Step2（2026-05-17）：**dead helper 削除**。`js/app.js` の `showToast(msg)` と `copyToClipboard(text)`（zero callers）+ `index.html` の `<div id="clipboard-toast">` + `css/style.css` の `#clipboard-toast` ルール削除。`SharedUI`/`SharedFmt`/`SharedCalc` は実コール 0 だが未採用インフラとして残置
- Phase 2c-Step3（2026-05-17）：**印刷スタイル再設計**。`css/quote.css:2519` の `@media print` を `body:has(#previewOverlay.open) > *:not(#tab-quote-make)` 等に書き換え。プレビュー印刷時にポータルヘッダー/ナビ/付箋/FAB/モーダル/トーストも全て非表示。プレビュー未表示時の Ctrl+P は通常印刷で何も加工しない
- Phase 2c-Step4（2026-05-17）：**Esc ハンドラのサイト全体化**。`js/quote/ui.js:884` の keydown ハンドラを 2 層化。第1層で `#fbOverlay` の Esc クローズをタブガード外に出し、第2層は従来通り見積タブ内モーダルを処理。付箋メモ・Ctrl+K 自体の globalize はコマンド一覧が見積タブ固有なため未実施
- Phase 2c-Step5（2026-05-17、phase 1 のみ）：**window.QuoteApp 名前空間ファサード**。`js/quote/constants.js` 末尾に `Object.defineProperties(QuoteApp.state, ...)` で 9 state + 5 data + 3 fx を二方向バインディング公開。既存 bare global は残置（callsite 移行は将来段階作業）
- Phase 3：旧「実務支援」を「フォワーダー支援」にリネーム

**Phase 2c で残った持ち越し（ユーザー明示依頼まで触らない）**
- バックアップファイル整理：`*.bak` / `*.bak_phase2c1_*` / `*.bak_phase2c2_*` / `index_bak_*`
- `見積支援/` の `_archive/` 化（1〜2 ヶ月の運用後）
- Step5-Phase2：~97 callsite を bare global → `QuoteApp.X` 形式に段階移行し最終的に bare global 削除
- `shared/{ui-utils,format,calc}.js` の採用 or 削除判断（callers ゼロ、Phase 1 で作成されたが未採用のインフラ）
- 付箋メモ・Ctrl+K コマンドパレットのサイト全体昇格（コマンドカタログの拡張要）

## このプロジェクトを触るときの注意

- **iCloud パス**：すべて `~/Library/Mobile Documents/com~apple~CloudDocs/` 配下。同期遅延でロックされることがあるので、複数端末で同時編集しない
- **見積支援/ は読み取り専用**：[見積支援/README.md](見積支援/README.md) に運用ルール明記。編集はポータル側 `フォワーダー支援/{index.html, css/quote.css, js/quote/*.js}` を編集すること
- **動作確認方法**：ブラウザで開くだけで動く（ビルド不要）。`file://` でも基本動くが、為替 API（fetch）や CDN（SheetJS）は CORS や `file://` の制限で失敗することがあるので、確認時は `python3 -m http.server` で簡易サーバを立てる
  ```sh
  cd "github/202605_コード改修" && python3 -m http.server 18765
  # http://localhost:18765/フォワーダー支援/index.html （ブラウザが URL エンコードする）
  ```
- **見積タブの初期化は遅延実行**：`switchTab('quote-make', this)` が呼ばれた初回に `window.initQuoteTab()` が走り、`initQuoteState() → initQuoteKeyNav() → initQuoteUI() → initQuoteAutoSaveListeners()` の順で初期化。冪等（`window.__quoteInitialized` でガード）
- **CSS スコーピング**：見積タブ専用スタイルは全て `#tab-quote-make` プレフィックス付き（quote.css）。タグセレクタ（`*`/`body`/`h1`/`table`/`th, td`/`select` 等）もスコープ済みでポータル他タブに漏れない
- **document.addEventListener('keydown')` のガード**：Ctrl+K と Esc は `#tab-quote-make.active` のときのみ発火（[js/quote/ui.js:884-887](フォワーダー支援/js/quote/ui.js:884)）
- **`document.addEventListener('input'|'change'|'paste')` は見積タブ内に限定**：自動保存・数式評価ペーストは `#tab-quote-make` 配下でのみ動作
- **バックアップファイル多数**（`*.bak` `*.bak2` `index_bak_*` 等）：ユーザーは手動バックアップを取る運用。整理は明示依頼があるまで触らない
- **Netlify デプロイ**は親プロジェクト `netlify/` 配下を別経路で配信中。`フォワーダー支援/` `見積支援/` のリネームは Netlify に影響しない（`netlify.toml` `deploy.sh` 確認済み）
- **localStorage キー**は `SharedStorage.KEYS`（`shared/storage.js`）に集約予定だが、見積支援由来コードは一部直書きキー（`autoSaveEnabled`, `quoteData`, `fxLastFetched_v1`, `stickyNote_v1`, `quoteFontSize` 等）混在。Phase 2c で統一予定
