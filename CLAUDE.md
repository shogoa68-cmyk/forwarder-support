# CLAUDE.md — フォワーダー支援統合プロジェクト

このディレクトリは、フォワーディング業務向けの Vanilla JS フロントエンドアプリ群を集約・統合する作業ディレクトリ。

> **作業前に読むこと**：製品方針 [PRODUCT_VISION.md](PRODUCT_VISION.md) / デザイン方針 [DESIGN_VISION.md](DESIGN_VISION.md)（リポジトリ直下）。不具合・改修の棚卸しは [docs/バグ台帳.md](docs/バグ台帳.md)。機能アイデア・改修要望は [docs/アイデア台帳.md](docs/アイデア台帳.md)。
> ※ VISION 文書は公開対象（GitHub Pages = `フォワーダー支援/`）に含めないため、リポジトリ直下に置く。
> ※ ユーザー公開ロードマップ：`docs/アイデア台帳.md` から `node scripts/build-roadmap.js` で `フォワーダー支援/roadmap.html` を生成（ヘッダー「📣 改修予定・アイデア」からリンク）。**台帳を編集したら再生成すること**。事業化・売却方針や内部技術詳細は生成時に自動除外。

## 構成（2026-06-12 / Phase 5 完了時点）

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
│   │       ├── constants.js   グローバル定数・通貨・カテゴリ・FX・`_inGroupRender` フラグ
│   │       ├── row.js         行追加/削除/ドラッグ並び替え/↑↓キー移動・サブコングループ表示・行ごと見積書非表示(👁/🚫)
│   │       ├── preview.js     プレビュー・CSV/Excel/PDF 出力
│   │       ├── quote-pdf.js   御見積書フォーマット PDF 出力（案A：原本忠実型）
│   │       ├── quote-email.js メール本文（プレーン/リッチHTML）出力・クリップボードコピー
│   │       ├── cargo.js       貨物情報・CBM/CW 計算
│   │       ├── conditions.js  引き合い条件・ゾーンビルダー・自動保存・操作履歴
│   │       ├── save.js        プリセット保存・読込・フィードバックモーダル
│   │       ├── select-mode.js 行選択モード（チェック ON で選択モード、一括操作）
│   │       ├── subcon-insert.js 👷 サブコン別行挿入（過去案件から費用行を集計・挿入）
│   │       ├── ui.js          UI・付箋・Ctrl+K・FX パネル・進捗バー・initQuoteTab()
│   │       ├── users.js       🧑‍💼 チーム管理（メンバー/ロール管理・admin/member/viewer）
│   │       ├── cloud-config.js ☁️ クラウド共有 接続設定（Supabase URL / publishable key・公開可）
│   │       └── cloud.js        ☁️ チーム共有（Google ログイン＋プリセットのクラウド保存/読込/削除）
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

## 🎨 Industry テーマ（Claude Design 案・既定オフ・元に戻せる）

Design 製の Industry 版デザイン（鋼青のブループリント調）を、**現行 CSS を書き換えず**に切替式で載せている。入口はヘッダー「🎨 デザイン」（画面／御見積書を別々に切替）、`?theme=industry|classic` でも切替可。`<html class="theme-industry|theme-industry-doc">` のときだけ `css/theme-industry*.css`（`node scripts/build-industry-theme.js` が `docs/design-handoff/industry/css/` と現行の差分から生成。**手編集禁止**）が効く。Industry 時のみ `row.js _insertCatHeaders()` がカテゴリ見出し行（`tr.subcon-cat-header`・表示専用の仮想行）を挟む。詳細・戻し方は [docs/デザイン変更の安全手順.md](docs/デザイン変更の安全手順.md)。**現行 CSS（style/quote/quote-pdf/tokens）を変えたら `build-industry-theme.js` を再実行**（差分が変わるため）。

**見積テーブルの行レイアウト（Industry・2026-10）**：明細行は「3段固定（高さ 120px）」。add-on は `quote-row-stage1-industry.css`／`quote-row-stage2-industry.css`（Design v3）→ `code-overrides-industry.css`（列幅 992px・実構造への補正・客先モード）の順。構造は `js/quote/row-layout.js`（状態チップ `.st-state`・「その他 ▾」パネル `.row-detail-panel`・`tr[data-ccy-diff]`・使用中バッジ）と `row.js calc()` の小計・利益（`.st-main/.st-sub/.st-state`、`.pr-main/.pr-sub`）。**Industry のときだけ**、有効期間 `.w-valid`・フラグ群 `.row-mode-btns`・`.pct-group`・`.row-cd` をパネルへ「要素ごと」移す（classic に戻すと元の場所へ戻す。id・onclick・data-* は不変）。更新日（`.w-updated`・`.grp-updated`）は CSS で隠すだけ（データ・機能は残置）。`.bp-base-hint`（原価換算＝赤字ライン）は Industry では行から隠し、売単価欄の `title` と「その他 ▾」の内訳に出す。仕様は `docs/design-handoff/industry/css/ROW-LAYOUT-SPEC.md`。

**新しい画面・部品の整理（Design 07 回答・Industry・2026-10）**：add-on は `quote-states-industry.css`（A-1 見出しの省略・小計の「注記 ▾」・A-2 ミニマム・A-3 枠の言語・A-4 用語集ドロワー）→ `master-admin-industry.css`（マスター管理）→ `code-overrides-industry.css`（補正・スマホのツールバー／ドック）。見出しの省略は `row.js` が `is-pt-solo`／`is-cat-solo` を付ける（DOM は残し CSS で隠す。折りたたみ・除外中は隠さない）。マスター管理は `stats.js`（見出し・件数・申請・表・「⋯」）と `alias-rules.js`（移行の案内）。**取り消しにくい操作は標準の `confirm()` ではなく `uiConfirm()`（`js/ui-confirm.js`）**。用語集は `ui.js` の `openQuoteGlossary()`（Industry はドロワー）。Design の `mobile-industry.css` は取り込まず（明細のカード型は保留）、スマホ幅は `code-overrides` に実セレクタで実装。仕様は `docs/design-handoff/industry/css/NEW-SCREENS-SPEC.md`、実装との差は `docs/design-handoff/requests/08-…`。

**適用する貿易条件（行ごと・2026-10）**：明細行に「貿易条件」ボタン（`.ic-mode-btn`・Industry は「その他 ▾」の中）→ 貿易条件のチップ（EXW〜CIF。`#cond-incoterms` の選択肢から生成）を選ぶと、**見積の貿易条件（往復案件は往路）がその中に無いとき**、行は「適用期間外」と同じ扱い（画面には薄く残り、客先向け出力・合計・小計から外れる）。実装は `row.js` の `rowOutReason(tr)`（`'incoterms'`／`'period'`）で、`dataset.outRange` に一本化しているため既存の除外処理（プレビュー・PDF・メール・CSV/Excel・合計）がそのまま効く。理由は `dataset.outReason`（プレビューのバッジ「🏷️ 貿易条件外」・Industry の状態チップ）。保存は行の保存配列の末尾 `ic`（32 番目・カンマ区切りのコード。空＝どの条件でも有効）。貿易条件が未設定のときは判定しない。

**サブコン見出しのマスター状態の印（サブコン別明細グループごと・2026-10）**：サブコン別グループの見出し（📦 サブコン名・行数の並び）の `.sv-master-chip` が、サブコン名のマスター状態を**グループに 1 つだけ**出す（行ごとには出さない）。マスターに無い名前は「⚠ サブコン未登録」（橙）、申請済みで承認待ちなら「📨 サブコン申請中」（青）。登録済み・サブコン未設定・別名で代表名が登録済み・未ログイン・サブコンのマスターが 1 件も無い間は出さない。Industry では見出しのボタンはホバーまで隠れるが、この印だけ常時表示（`code-overrides`）。状態の判定は `stats.js` の `statsMasterState(field, value)`（`'master'|'pending'|'none'|'unknown'`・O(1)）、見出しの更新は `row.js` の `refreshAllRowSvChips`（`renderSubconGroups` の最後・マスター読込（`arRefreshDatalist`）・申請の作成で更新）。印を押すと `alias-rules.js` の `arCheckSubconRow(input, anchor)` が、見出しの下に登録の確認（承認制のメンバーは「登録を申請」、管理者・従来は「マスター登録」）を出す。**マスター登録済みのサブコンは、明細行の `.sv-detail-btn`「サブコン詳細」（品名の「詳細」の隣・登録済みのときだけ表示。別名で入力しても代表名）から、`statsShowUsage('sv', 代表名, ev, {info:true})` で登録状態・別名・使用案件の一覧・「マスター管理で開く」を見られる**（`row.js` `_refreshRowSvDetailBtns`）。

**サブコン見出しの「📇 詳細」「🔖 BOOKMARK」（2026-10）**：サブコン別グループの見出し（`row.js renderSubconGroups`・更新は `_refreshSvHeaderChips`）に、マスター登録済み（別名で入力しても代表名）のとき `.sv-hdr-detail`「📇 詳細」を出す＝`conditions.js mdShowDetailPopup('sv', 代表名)`（マスターの詳細＝サブコン種別・ふりがな・英語名・添付）。マスターの種別（`details.svTypes`）が FCL／LCL／AIR CARRIER のときは `.sv-hdr-bm`「🔖 BOOKMARK」も出し、`bookmarks.js bmShowForCarrier(代表名, ev)` が、そのキャリアのブックマーク（別名・代表名で登録したものも）を小さなポップアップに出す（リンク／添付ファイルのチップ・クリックは通常のチップと同じく記録・「＋ ブックマークを追加」＝`openAddBmModal({carrier})`・未ログインは「ログインすると…」）。未登録・サブコン未設定のときは出さない（未登録は従来どおり印）。Industry では見出しのボタンはホバーまで隠れるが、この 2 つは常時表示（`code-overrides`）。ポップアップの CSS は `style.css` の `.sv-bm-pop*`。テストは `sv-master-chip-test.js`。

**数量パターンの常時表示（2026-10）**：数量パターン（FCL案／LCL案など）を 2 つ以上使っているとき、見積テーブルの操作バー（sticky）の上段 `#qtyPatternBar` に、パターンの切替チップ（編集中は濃く・FCL＝緑／LCL＝青／指定なし＝茶）・「⚠ 要確認 N 行」（`.pq-pattern-needs-check` の数。押すと最初の行へ）・枠線の凡例を出す。表の数量の列見出し（`#hdQtyPat`）に編集中のパターン名、`#tab-quote-make[data-qpat]` で表の上端の線と列見出しの下線をパターンの色にする。描画は `conditions.js` の `renderQtyPatternBar()`（`_renderPackingPatternTabs`／`switchPackingPattern`／`_applyPatternQtyLinks`／`row.js _recordPatternQty` から更新）。保存データは変更なし。**置き場所（2026-10）**：画面幅が広いとき（681px 以上）は、`#qtyPatternBar` を上部ツールバー（`#saveToolbar`）の「⋯」の左の空きへ移して表示（`conditions.js _placeQtyPatternBar`・`matchMedia('(max-width: 680px)')` で、狭い画面では表の操作バー `.quote-cmdbar` の先頭へ戻す。要素は 1 つのまま移すだけ）。ツールバーの高さは変えない（チップ 24px・操作バーの `top` の前提を保つ）。長い名前は `.qpat-name` を 220px で「…」に切り（全文は chip の `title`）、多いときは横スクロール、凡例は 1700px 未満で省く（枠線の見方は「📦 数量パターン」の `title` に）。あわせてツールバーは 1100px 以上で左のセクションナビ用の余白（68px）まで広げ、カテゴリの行と幅をそろえた（`margin-left:-68px`）。テストは `scripts/design-tests/qty-pattern-toolbar-test.js`。

**左端のセクションナビ／右パネルは費用テーブルの縮小表示（2026-10）**：見積入力画面の左端に `#qSecNav`（管理番号・貿易条件・貨物情報・物量情報・作業範囲・リマーク・費用）を常設（`.quote-workspace` の直前に置いた高さ 0 の `position:sticky` の入れ物の中の `.q-secnav-box` を左の余白に出す＝最上段では本文の先頭に並び、スクロールするとツールバーの下に付く。`fixed` だと最上段でヘッダー・タブ・ツールバーの下に潜った）・押すと `openQuoteSectionFromDigest` でセクションを開いてスクロール・いま見ているセクションを強調・「入力済み」の印は `ui.js _updateSecNavMarks`＝`renderQuoteSectionDigest` の判定）。ダッシュボードでは出さない。幅 1100px 以上は本文に左余白 68px、未満は固定をやめて編集画面の上の横並びのリンク。右レールの「ジャンプ」は「費用」（`#qspPane-digest`）に改名し、中身は費用テーブルの合計行とサブコン・パターン・明細のツリーだけ（各セクションの要約は廃止）。ナビにはセクションの要約は出さない。

**カテゴリナビの「📂 その他」メニュー（2026-10）**：上段のカテゴリは「BOOKMARK・見積・統計・マスター管理」（この順・4 つとも `cat-btn-bookmark`＝BOOKMARK のティール系の色に統一。選択中は濃いティール）＋「📂 その他 ▾」の 5 つにし、残りの 7 カテゴリ（諸チャージ／カレンダー／本船・航路／Booking/SI／書類・通関／計算／知識・参考）は「その他」のメニューに集約（情報は減らさない）。`cat-btn-featured`（旧・橙系）はマークアップでは使わなくなった（CSS は残置）。見積ボタンなどを探すときは `.cat-btn[aria-controls="tab-quote-make"]` のように `aria-controls` で探す（`calculator.js`・BOOKMARK 管理ボタンもそう）。メニュー内のボタンは従来の `.cat-btn` のまま（`onclick="switchCategory(...)"`・`aria-controls` 不変なので `calculator.js`／`conditions.js` の探し方もそのまま効く）。開閉・選択中の表示は `js/cat-more.js`（パネルは `position:fixed`＝スマホ幅の `.cat-nav` 横スクロールで切れない・Esc／外側クリック／スクロールで閉じる・メニュー内が選択中のとき「その他」ボタンが強調され名前が出る＝`.active` の変化を MutationObserver で追従）。CSS は `style.css` の `.cat-more*`（Industry も共通）。テストは `scripts/design-tests/cat-more-test.js`。

**見積入力ツールバーは「⋯」に集約（2026-10）**：上部ツールバー（`#saveToolbar`）には「ダッシュボードに戻る」と作業中の表示、右端の「⋯」だけを出す。元に戻す・やり直す（`#btnQuoteUndo/Redo`）／メール取込／サブコン依頼メール／表示サイズ／表示モード（かんたん｜詳細）は `.toolbar-extra` を付けて `quote.css` で常に隠し（DOM・id は残す）、同じ処理を「⋯」メニュー（`#tbMenuMore`）に並べた（操作／取り込み・送る／設定。メニューの元に戻す・やり直すは `#btnQuoteUndoMenu/RedoMenu`＝`conditions.js _updateHistoryButtonsUI` が元ボタンと同じ状態に更新。Ctrl+Z/Y は従来どおり）。かんたん表示・スマホ幅で行っていた「⋯」への集約を、詳細表示にも広げた形（`.tb-mi-simple` は常時表示）。テストは `scripts/design-tests/toolbar-more-test.js`。

**マスターの見せ方は「マスター＋別名」の 1 つ（2026-10）**：旧「同義グループ／代表／個別マスター／正規形／置換元」は画面から消し、「マスター（正しい名前）＋別名・略称」に統一（データは `master_votes` と `synonym_groups` の 2 テーブルのまま）。統計タブのボタンは「☆ マスターに登録」「→ 別名にする」、マスター管理は「＋ 別名」「他のマスターにまとめる」「別名をすべて外す」、エイリアス是正は「マスター名／古い表記／過去データの一括置換」。**承認制のとき**、メンバーの別名追加は `master_requests.alias_of` の申請になり、管理者の承認で `synAddAlias` が走る（`stats.js statsRequestAlias/_decide`）。マスター名・別名の直接変更は管理者のみ（`alias-rules.js _synRestricted`）。`docs/sql/synonym-groups-approval.sql` を実行するまでは従来どおり（メンバーも直接追加可）。別名を足すと別名側の詳細をマスターへ合流し（`_mdAbsorbAliasDetails`・別名側の記録は残す）、添付は別名側のものも合わせて表示（`_maValuesOf`）。**お客様詳細（2026-10）**：ウェブサイトは一覧の詳細チップでリンクチップ（`a.stats-md-link`・http/https のみ・新しいタブ）。担当者ごとの所属部署・課 `contacts[].dept` と所在地 `contacts[].location`（編集欄・一覧チップの 📍・見積タブの詳細ポップアップに表示）。**担当者の敬称・タグ絞り込み（2026-10）**：担当者名は入力では敬称略で保存し、表示（マスター管理の一覧・見積タブの詳細ポップアップ・ご担当者の入力候補）では `formatPersonWithHonorific` で「様」を付ける（出力 PDF/メールは従来どおり付与）。マスター管理の絞り込みチップは、サブコン＝サブコン種別、お客様＝タグ（`_SUB_FILTER`）。**担当者の部署・役職を御見積書の宛先へ（2026-10）**：担当者に `contacts[].title`（役職）を追加。ご担当者欄の氏名がお客様マスターの担当者と一致（敬称・空白の違いは無視）すると、PDF の宛先は「会社名／所属部署・課／役職 氏名 様」、画面プレビューの「担当」は「部署・課 役職 氏名 様」になる（`preview.js getRecipientExtra`・`quote-pdf.js _formatRecipient`。英語出力・Excel/CSV・メール本文は対象外。切替チェックなし）。テストは `scripts/design-tests/recipient-extra-test.js`。**取引ルール（お客様・担当者ごと／2026-10・段階 1）**：案件が続くと生まれる固有の決まりごとを 1 件ずつ登録しチーム共有（`js/customer-rules.js`・テーブル `customer_rules`・**`docs/sql/customer-rules.sql` を Supabase で実行する前提**。未実行でも他機能は無影響）。対象＝お客様全体／特定の担当者、重さ＝メモ／要確認／厳守、背景・登録者・最終確認日つき（半年超で「再確認」表示）・廃止は履歴に残る。登録はマスター管理のお客様の詳細（`#crPanel`・`crMountPanel`）と、見積タブの `#crBanner`（お客様・ご担当者を選ぶと当てはまるルールを表示・厳守があれば開く・「＋ ルールを追加」）。`crRefreshBanner` は `qfRefreshCustomerDetailBtn` と `#qf-person` の入力で更新。**社内専用**（御見積書・メール・プレビューには出さない）。**出力前チェックへの連携（段階 2）**：プレビュー・PDF・Excel・CSV・コピーの前の確認ガイド（`preview.js preOutputValidationGate`）に、お客様・ご担当者に当てはまる「厳守」「要確認」ルールを確認事項として出す（メモは出さない・厳守は強調・「このまま出力」で続行できる）。テストは `scripts/design-tests/rules-gate-test.js`。**案件からルールにする・再確認の運用（段階 3）**：見積タブのバナーのボタン「📌 この案件で気づいたことをルールにする」は、背景に「案件 {管理番号} で判明」を自動入力して開く。最終確認から半年超のルールは、バナーに「⏳ 再確認 N件」と各ルールの「いまも有効」「廃止」ボタンを出し、マスター管理のお客様の行には「📌 ルールN件 ⛔厳守 ⏳再確認」の印（`stats.js _crChip`）、画面上部には再確認が必要なお客様の案内（`_crStaleNotice`）を出す。次段階：傾向の自動提案。**マスターの詳細はポップアップ（2026-10）**：マスター管理の「詳細」は、表の行の下に広がる形をやめ、画面中央のモーダル（`#mdDetailModal`・幅 最大 980px・中だけスクロール・Esc／✕で閉じる・保存／削除で閉じる）で開く（`stats.js statsToggleMasterDetail`／`statsCloseMasterDetail`）。中身（入力欄・添付・取引ルール）は従来どおり。**種別・タグでの並べ替え（2026-10）**：マスター管理でサブコン／お客様を選ぶと「並び順：名前順／種別（タグ）ごとにまとめる」を出す（`statsMasterSetSort`）。「まとめる」は種別・タグごとの見出し行（`.master-tag-group-row`・件数つき・件数の多い順）の下に並べ、複数持つものはそれぞれの下に出し、なしは最後。絞り込みチップと併用できる。**所属グループ（サブコン・キャリア／2026-10）**：グループ傘下の別会社（例：CMA CGM／ANL／APL／CNC）は、別名にせず別のマスターのまま、詳細の `group`（所属グループ・1 つだけ・入力済みの名前が候補）でつなぐ。マスター管理は「🏢 所属グループごとにまとめる」（見出しは傘下の社数つき・グループなしは最後）、統計タブのサブコン・キャリアは冒頭に「所属グループ別の合計」（別名の件数も傘下の会社に合算・内訳つき・`stats.js _groupSummaryHtml`）、見積タブのサブコン見出しには `.sv-hdr-group`「🏢 グループ名」（`row.js _refreshSvHeaderChips`）。SQL は不要（詳細の JSON に入る）。**サブコンとキャリアの統合・段階 1（2026-10）**：サブコンのマスターのうち種別がキャリア系（`FCL／LCL／AIR／RORO／在来船 CARRIER`。ひな形に RORO CARRIER・在来船 CARRIER を追加）を、①幹線輸送のキャリア候補 `#carriers-dl`（輸送モードの種別に合うものだけ・`conditions.js qfRefreshCarrierMasterCandidates`）②ブックマーク追加の会社名候補 ③サブコン見出しの「🔖 BOOKMARK」の判定、に使う（`alias-rules.js mdCarrierNames/mdIsCarrierType`）。既存の `carrier` マスターや過去データは触らない（読み取り経路を足しただけ）。**段階 2 の準備＝影響範囲の確認（読み取りのみ）**：マスター管理でキャリアを選ぶと「影響範囲を確認する」ボタン（`stats.js statsCarrierMigrationReport/statsShowCarrierMigrationReport`）。キャリアのマスターを「そのまま移せる／合流が要る（サブコンに同じ会社）／要判断（別名がサブコンとぶつかる）」に分け、件数・使用件数・詳細の食い違い・種別の自動判定の見込みを出す。SQL 版は `docs/sql/carrier-sv-migration-count.sql`。データは変更しない。**段階 2＝移行の実行（`js/carrier-migration.js`・管理者のみ）**：影響範囲の画面から「移行の変更一覧を見る」→「この内容で移行する」（`cmShowPlan`／`cmBuildPlan`／`cmExecute`）。サブコンに同じ会社が無いキャリアは新規登録（詳細・別名・グループを引き継ぐ）、あるもの（合流・要判断）は既存のサブコンへ種別（ブックマークの種別から自動）を足し・詳細は空欄だけ補い・別名（キャリア側の別名と表記違いの名前）を足す。別のサブコンの名前とぶつかる別名は足さず注意を出す。**元のキャリアのマスターは消さない**・実行前に控え JSON を自動ダウンロード・足りない分だけ足すので再実行しても二重にならない。段階 3（`carrier` カテゴリ廃止）は未着手。引き継ぎ：`docs/引き継ぎ-サブコン・キャリア統合-2026-10-29.md`。**港の「国」（国ごとの情報の土台・段階 1／2026-10）**：港のマスターの詳細に `country`（国コード ISO 2 文字で保存・表示は日本語名「ベトナム（VN）」。入力は国名・国コードのどちらでも可）。候補と港→国の対応表は `data/countries.js`（`COUNTRY_LIST`・`findCountry`・`countryLabel`・`guessPortCountry`＝主要港の名前から推測）。マスター管理で港を選ぶと「国：」の絞り込み・「国ごとにまとめる」・「国を自動で付ける（候補を確認）」（`statsShowPortCountryAssist`＝確認してから反映・すでにある国は変えない）。**今後の構想**（ユーザー合意済み）：国のマスターに国ごとのルール（B/L 規則・輸入規制・書類など。当面は箇条書きの文書）を持たせ、見積の POL／POD の国のルールを画面で参照でき、リマークへ 1 クリックで挿入できるようにする（段階 2〜5）。**サブコン種別（2026-10）**：サブコンの詳細 `svTypes`（複数・タグ形式。ひな形ボタン＋自由追加・他者が追加した値も候補）。マスター管理でサブコン選択時のみ「種別：」の絞り込みチップ（`statsMasterSetSvType`・未設定あり）。Industry のマスター管理の表は `table-layout:fixed`（`code-overrides-industry.css`）で枠からはみ出さない。**単位の別名もクラウド共有（段階 C）**：`uaGetGroups/uaAddAlias` 等は `synonym_groups`（field='un'）への薄い入口に変更（端末ローカルの `unitAlias_v1` は廃止し、移行の案内でクラウドへ移す）。別名の追加・マスター名変更は「先に新しい所属を書き、そのあと古い所属を外す」順にして、途中で失敗しても別名が消えない（最悪でも二重所属）。

**お客様の取引ルールの帯の置き場所（2026-10）**：見積入力「管理番号入力」の `#crBanner`（`customer-rules.js crRefreshBanner`）は、メモの左横の左カラム（見積もり番号・お客様名・ご担当者の下）に置く（`style.css .cr-banner{grid-column:1; align-self:start}`）。以前は `grid-column:1/-1`（全幅）で、メモ（`grid-row:1/span 8`）の下に回り込み、左カラムに空きができていた。帯が出ているときだけ親 `.quote-header` に `has-cr` を付け、メモを `span 9`（左が 1 行増える分）にする（`quote.css`・681px 以上）。かんたん表示でメモが隠れている間（`#refBody:not(.tier-opt-open)` かつメモ未使用）は、右が空くので帯を全幅にする（`simple-mode.css`）。テストは `scripts/design-tests/customer-rules-layout-test.js`。

**全タブの画面幅は共通（2026-10）**：`.app`（ヘッダー・カテゴリの行・各タブの本文を包む）は全タブとも `max-width:none`・左右 8px（`style.css`）。以前は見積タブ以外だけ `max-width:1440px`（1480px 以上は `65vw`）で、タブを切り替えるとヘッダーやカテゴリの行の幅まで変わっていた。見積タブはテーブルの `min-width:1300px`・左のセクションナビ・右パネルがあるため、見積タブ以外の幅（1235px など）には合わせられず、全タブを画面幅いっぱいにそろえた。Industry は Design の `style.css` が旧い幅制限を持つため、`code-overrides-industry.css` 末尾の `.app{max-width:none}` で打ち消している（`build-industry-theme.js` を再実行しても残る）。テストは `scripts/design-tests/app-width-test.js`。

**御見積書の為替注記（2026-10）**：為替の出典・取得日時・参考値の注記は、幅 140px のレート表の下（`.qd-rate`）ではなく、御見積書の下端（`.qd-foot` の直後）に横幅いっぱいの 1 行 `.qd-fxnote` で出す（`quote-pdf.js`・折り返しで読みにくくならないように）。文面は `preview.js getFxAuditMeta()` が 1 か所で作る：「為替：open.er-api.com 中値（YYYY/MM/DD HH:MM 取得）／参考値であり、実際の決済レート（TTS等）とは異なります。」（自動取得していないときは「為替：手動設定値（自動取得未実行・基準レート確認日…）／参考値であり…」）。PDF は末尾に「作成日：…」を続け、画面プレビュー・Excel・コピー用も同じ文面を使う。テストは `scripts/design-tests/fx-note-test.js`。

## 🗑️ 自動保存は廃止（2026-10）

旧「自動保存」（localStorage `quoteData` に1件・復元バナー）は、ページ再読込後に空の状態で上書きされて復元できない不具合があり、ブラウザ保存／チーム共有と役割も重なるため**廃止**。保存はチーム共有（旧「ブラウザ保存」は廃止）、巻き戻しは Undo/Redo。`scheduleAutoSave()` は呼び出し元（約100か所）を変えないため**何もしない関数として残置**。起動時（`initQuoteState`）に旧データ（`quoteData`・`autoSaveEnabled`）を掃除する（後日削除可）。

## 🟦 かんたん表示（新規ユーザー向け・既定は段階導入中）

IT に不慣れな新規ユーザーにも分かりやすいよう、Design 案の「かんたん表示」を切替式で導入中。`<html class="mode-simple">`＝かんたん／無し＝従来の詳細（保存 `fwd.uiMode`、`?mode=simple|detail`）。**既定値は `index.html` の `UI_MODE_DEFAULT`（現在 `'detail'`。検証後に `'simple'` へ）**。実装：`js/ui-mode.js`・`css/simple-mode.css`・`cloud.js`（案件カード／リスト／「⋯」メニュー）。隠す項目は DOM に残す（保存・計算は継続）。ダッシュボード・見積入力画面とも実装済み（見積入力は `data-tier` で区分、上級機能を使っている案件は自動で項目を表示）。引き渡し資料は `docs/design-handoff/simple-mode/`、手順は [docs/デザイン変更の安全手順.md](docs/デザイン変更の安全手順.md)。

**手順の道しるべは追従する（2026-10）**：かんたん表示の見積入力画面の上部 `#qpGuide`（①条件 ②貨物 ③費用 ④出力）は `position:sticky`（`simple-mode.css`・上部ツールバーの直下＝`top: nav-cat-h + 44px`）でスクロールに付いてくる。固定されるのはボタンの 1 行だけにするため、ひと言の案内 `#qpHint` は道しるべの外（直後）に出した（`ui-mode.js` は id で更新）。下の操作バー `.quote-cmdbar` の `top` と `.condition-section` の `scroll-margin-top` は、かんたん表示のときだけ道しるべの高さ（`--qp-guide-h:46px`）の分だけ下げる（詳細表示は従来どおり）。上部ツールバーは `min-height:44px`（ボタンを「⋯」へ集約して低くなっても、固定する各バーの `top` の前提＝44px に合わせて隙間を作らない）。スマホ幅（680px 以下・ツールバーが static）は `top: nav-cat-h`。テストは `scripts/design-tests/guide-sticky-test.js`。

## ☁️ クラウド共有（チーム間でのプリセット共有）

見積プリセットを複数ユーザーで共有する機能。プリセット管理モーダル内「☁️ チーム共有」セクションで操作。

- **バックエンド**：Supabase（静的サイト構成は維持。`supabase-js` を `<head>` で defer 読み込み）
- **認証**：Google ログイン（Supabase Auth / OAuth）。`cloud.js` の `cloudLogin/cloudLogout`
- **保護**：RLS（Row Level Security）。`allowed_emails` テーブルに登録されたメンバーのみ読み書き可（判定は `security definer` 関数 `is_team_member()` 経由）。Google でログインできても許可リスト外はデータに触れない
- **編集権限**：許可メンバーは全員が編集・削除可（`for all` ポリシー）
- **編集ロック（作業中状態）**：案件を「✏️ 編集」で開くと `locked_by/locked_at` を取得し、他メンバーの削除/上書きを RLS で拒否（`cloud.js` の `_takeLock` 等）。保持中は 30 秒ごとの **renew-only ハートビート**（`quote_renew_lock`）で延命。**10 分間無操作だと放置とみなし自動で解放＋閲覧モードへ**（`LOCK_IDLE_LIMIT_MS`・`_onSelfIdleRelease`）、クラッシュ/タブ閉じは 90 秒で自動失効。**管理者（`get_my_role()='admin'`）はカードの「⋯」→「🔓 強制解放（管理者）」で他人のロックを即時解除可**（`cloudAdminReleaseLock` → `quote_admin_release_lock`）。解放された放置タブは次のハートビートで検知し閲覧モードへ落ちる（`_onLockLost`）。**クールダウン**：ロックは email（ユーザー）単位のため、同一ユーザーが複数タブで同じ案件を編集中に片方が放置/クローズでクリアすると、もう片方が蹴り出され得る。これを防ぐため、renew 失敗時はまず acquire を試み、**握り直せれば継続（自分の別タブがクリアした等）／`'COOLDOWN'` か他者 email なら本当に失ったとして閲覧モードへ**。管理者強制解放は `force_released_from/at` を記録し、`quote_acquire_lock` が「強制解放された本人」の再取得を 60 秒だけ `'COOLDOWN'` で拒否する（＝放置タブの握り直しは防ぎ、本人の別タブ由来のクリアは印が無いので影響しない）。**スキーマ `quote_acquire_lock`（改訂）/ `quote_renew_lock` / `quote_admin_release_lock` と列 `force_released_from/at` は `docs/supabase-schema.sql` を Supabase で実行する前提**（未適用でも UI は安全に no-op・renew は旧 acquire にフォールバック）
- **テーブル**：`quote_presets { id, name, data(jsonb), status, customer, person, owner_email, created_by, editors(jsonb), updated_at }`。`data` はローカル `quotePresets_v1` と同形式（`gatherAllData()` / `_applyQuoteData()` 互換）
- **作成者・更新者**：`created_by`＝作成者（1名・不変）、`owner_email`＝最終更新者、`editors`＝更新した人の履歴 `[{email, at, count}]`（新しい順・最大20件）。`editors` は BEFORE INSERT/UPDATE トリガー `bump_quote_preset_editors()` が自動更新するため、保存経路（保存／ダッシュボードのステータス変更）を問わず取りこぼさない。編集ロックや Presence だけの更新（`data`・`status` が不変）は加算しない。**スキーマは `docs/sql/quote-preset-editors.sql` を Supabase で実行する前提**（未実行でもカードは最終更新者のみで動作）
- **案件ステータス／検索**：`status`（下書き中/提示済み/受注/失注）を行ごとにプルダウン変更・色分けバッジ・チップで絞り込み。検索ボックスは名前・顧客名・担当者でクライアント側フィルタ（フェーズ1）。`customer`/`person` は保存時に `data.fields['qf-customer'/'qf-person']` から列へ昇格。`created_by`＝作成者、`owner_email`＝最終更新者
- **件数**：クラウド側は実質ほぼ無制限（無料枠 500MB ÷ 約4KB/件 ≒ 約12万件）。ローカル localStorage のみ最大50件
- **キー**：`cloud-config.js` の `publishableKey`（`sb_publishable_...`）はブラウザ公開前提・RLS で保護されるためコミット可。**`sb_secret_...`（service_role）は絶対にコミットしない**
- **ブラウザ保存は廃止（2026-10）**：保存・呼び出しはチーム共有（クラウド）に一本化。ツールバー／モバイルメニューの「💾 ブラウザ保存」、プリセット管理モーダルの左列、統計の「ローカル／クラウド」切替、`savePreset`/`loadPreset`/`deletePreset`/`getPresets` などを削除。**ログインしないと保存できない**（未ログインは入力・計算・プレビュー/PDF出力のみ）。Ctrl+S ＝ `cloudSaveCurrent()`。このブラウザの localStorage `quotePresets_v1` に残る旧データは、ダッシュボード先頭の案内（`#qpdLocalMigrate`、`cloudMigrateLocalPresets` / `cloudDiscardLocalPresets`、マスター移行と同じ見た目）から「チームへ移す」（同名は別案件として保存・元データは控え `quotePresets_v1_migrated` に残る）か「移さない（破棄）」。列の導出は `_presetColumns(data)`（保存と移行で共通）。見積の比較（`openCompare`）はチーム共有の案件（更新順 100 件）が対象
- **未設定でも安全に no-op**：`cloud-config.js` がプレースホルダのままなら `cloudIsConfigured()` が false を返し「未設定」表示で停止
- **OAuth リダイレクト**：`signInWithOAuth` の `redirectTo` は現在URL。Supabase の Authentication → URL Configuration の Redirect URLs に公開URL/ローカルURL（`http://localhost:PORT/**`）を登録しておくこと

## 🔖 チームブックマーク（全面クラウド移行・編集履歴）

船会社／サブコンのリンクを `bookmarks` テーブルで一元管理（`js/bookmarks.js`・`#tab-bookmark`）。見積タブ右カラムの「🔖 ブックマーク」タブ（`renderQuoteBookmarkRail` / `#bmRailPanel`）に案件連動で表示。

- **全面クラウド移行**：旧「内蔵船会社DB（`data/carriers.js`）の静的リンク（青）＋ユーザーBM（緑）」の2系統を廃し、**クラウドの `bookmarks` 1系統に統合**。`getCarrierLinkData()` は内蔵静的リンクを返さず `_qspBmCache`（クラウド）のみを真実とする。**ログイン必須**（未ログイン時はチップ空）
- **シード**：`seedCarrierBookmarks()`（BOOKMARK タブ「🌱 内蔵リンク取込」）で `data/carriers.js` の内蔵DB（FCL/LCL/AIR）＋`CARRIER_LINK_DEFS` を `_buildCarrierSeedRows()` 経由で `bookmarks` へ一括投入。`carrier`+`url` 重複はスキップ＝冪等。初回デプロイ後に1回実行する運用
- **全チップ編集可**：rail/一覧の各チップは ✎ で `openAddBmModal({id,...})`（編集モード）→ `bookmarks` を UPDATE。`fetchCarrierBmsForQSP()` は `carrier_type` も取得し編集時の種別を保持
- **編集履歴**：Supabase の `bookmark_history` テーブル＋`log_bookmark_change()` トリガー（INSERT/UPDATE/DELETE の前後 jsonb スナップショット・実行者 `auth.jwt()->>'email'`）。BOOKMARK タブ「🕘 履歴」（`openBmHistory()`）で新しい順に表示。**スキーマは `docs/sql/bookmarks-migration.sql` を Supabase で実行する前提**（`is_team_member()` に依存）
- **TODO**：チップの色分けを「出自」から「用途別」へ（現状は全チップ共通スタイル＝緑系に統一）

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
- Phase 4（2026-06-07、PR #93〜101）：**クラウド機能拡張・キャリアチップ・物量転記**
  - クラウドプレビューに貿易条件・輸送モード・貨物/物量情報を追加表示（`_cpRenderCondInfo()`）
  - 複数航路（`z2-routes-data`）のプレビュー・DB列昇格対応
  - 類似見積プレビューを `cloudPreviewPreset` に委譲（行インポート対応）
  - `user_profiles` テーブルによるメール→表示名マッピング（`_profileMap` / `_nameFor()`）
  - メール本文の明細を1行表示に修正（`buildPlainDetailLines()`）
  - キャリアリンクチップに `✎` 編集アイコン ＋ 末尾「＋」新規追加チップを実装
  - `openAddBmModal(presetData)` を引数対応に拡張（`_inferBmFunction` / `_inferBmType`）
  - 見積サマリ物量情報（CBM/RT/CW）行に「→見積」転記ボタンを追加（`renderQuoteCargoInfo()` 拡張）
- Phase 5（2026-06-07〜06-12、PR #104〜112）：**QSP チップ・採番・共有強化・行パターン・UI 改修・グループ表示・進捗バー**
  - **QSP ブックマークチップ**（PR #104〜107）：z1/z3 サブコンに QSP チップ追加・ブックマーク即時同期・会社名欄保護
  - **仮 REF# 自動採番**（`d7fdea5`〜`cfe1e8f`）：発番 ID 2 桁＋YYMMDD＋連番 3 桁（例：05-2606100-02）。管理者が発番 ID を任意変更可。プリセットカード見出しを仮 REF# のみに（顧客/担当は下段分離）
  - **プレビュー拡張**（`ef69c61`）：案件詳細プレビューに仕入/売単価分離・載せ幅・粗利率を追加
  - **チーム共有強化**（`0b9f554`〜`d04012d`、`2fb27a5`）：Presence + 競合検知・プロフィール編集・作業モード（閲覧/編集）・編集を RLS で強制ロック化（3 分自動失効・ハートビート）。`users.js`（チーム管理 UI）追加
  - **行パターン拡張**（`16ac717`〜`57776db`）：編集モーダル（参照 URL 複数・明細並替）・部分挿入（任意行選択挿入）・インライン編集＋行追加。`subcon-insert.js`（サブコン別集計・行挿入）追加
  - **UI 改修**（`7d1552d`〜`41317d3`）：貨物情報セクション再設計（関税率サブカード・危険品チップ化）・行追加ツールバー sticky 化・選択行ツールバーをカテゴリ/サブコン一括設定に刷新（`select-mode.js` 追加）・複数航路表示集約・「お客様」表記統一・モバイル縦積み対応
  - **出力機能追加**：`quote-pdf.js`（御見積書フォーマット PDF）・`quote-email.js`（プレーン/リッチ HTML メール本文）
  - **CI 改善**（`4774983`）：デプロイ時に CSS/JS へ `?v=<sha>` を自動付与（キャッシュバスト）
  - **ロードマップ修正**（PR #110）：`build-roadmap.js` が HTML コメントブロックを実アイテムとして誤解析するバグを修正
  - **サブコン別グループ表示**（PR #111）：テーブル行をサブコンごとに視覚グループ化。仮想 TR（`data-virtual="1"`）で実装（保存・CSV/Excel/PDF 出力には含まれない）。グループ内のみドラッグ・↑↓移動可。**グループ見出しのグリップ（⠿）をドラッグするとブロックごと並べ替え可**（`initGroupHeaderDrag` / `moveSubconGroupBlock`・別ヘッダー上にドロップで前後挿入）
  - **プリセット進捗バー**（PR #112）：ブラウザ保存・チーム共有の両カードに 5 ステップ進捗バー（条件→貨物→仕入→利益→出力）を追加（`_calcQuoteProgress()` / `_progressBarHtml()`）

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
- **見積タブの初期化は遅延実行**：`switchTab('quote-make', this)` が呼ばれた初回に `window.initQuoteTab()` が走り、`initQuoteState() → initQuoteKeyNav() → initQuoteUI()` の順で初期化。冪等（`window.__quoteInitialized` でガード）
- **CSS スコーピング**：見積タブ専用スタイルは全て `#tab-quote-make` プレフィックス付き（quote.css）。タグセレクタ（`*`/`body`/`h1`/`table`/`th, td`/`select` 等）もスコープ済みでポータル他タブに漏れない
- **document.addEventListener('keydown')` のガード**：Ctrl+K と Esc は `#tab-quote-make.active` のときのみ発火（[js/quote/ui.js:884-887](フォワーダー支援/js/quote/ui.js:884)）
- **`document.addEventListener('input'|'change'|'paste')` は見積タブ内に限定**：自動保存・数式評価ペーストは `#tab-quote-make` 配下でのみ動作
- **バックアップファイル多数**（`*.bak` `*.bak2` `index_bak_*` 等）：ユーザーは手動バックアップを取る運用。整理は明示依頼があるまで触らない
- **Netlify デプロイ**は親プロジェクト `netlify/` 配下を別経路で配信中。`フォワーダー支援/` `見積支援/` のリネームは Netlify に影響しない（`netlify.toml` `deploy.sh` 確認済み）
- **localStorage キー**は `SharedStorage.KEYS`（`shared/storage.js`）に集約予定だが、見積支援由来コードは一部直書きキー（`fxLastFetched_v1`, `stickyNote_v1`, `quoteFontSize` 等）混在。Phase 2c で統一予定
