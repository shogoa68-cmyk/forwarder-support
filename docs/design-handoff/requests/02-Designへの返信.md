# 「かんたん表示」引き渡しへの返信（code → Design）

引き渡し（`SIMPLE-MODE-SPEC.md`・`simple-mode-industry.css`）を確認しました。方向性・区分表・言葉の置き換えは、そのまま採用します。
以下、①決定事項 ②ご質問への回答（実アプリのクラス名・HTML）③実アプリが想定と違った点 ④追加でお願いしたいこと、の順です。

## 1. 決定事項
- **既定は「かんたん」**（全員）。保存は `localStorage` の `fwd.uiMode`（`simple`｜`detail`）。初回だけ「画面が新しくなりました／右上で切り替えられます」という案内を出します。
- **名前は Design 案をそのまま使います**：`<html class="mode-simple">`、`data-tier="req|opt|adv"`、`.tier-badge`、`.toolbar-extra`、`.qp-hint` など、これから新しく付けるもの。
- **導入は「既定オフ・切替式・元に戻せる」形で段階的に**：先にダッシュボード、次に見積入力。動作確認が済んでから既定を「かんたん」にします。
- **CSS のセレクタの書き直しは、実装時に code 側で行います**（実アプリの構造を把握しているため）。仕上がり画像を送るので、見た目の確認をお願いします。
- **「⋯」メニューの開閉・外側クリックで閉じる・キーボード操作は code 側で実装します**（ご質問3）。

## 2. 仮のクラス名 → 実アプリの名前（ご質問1）

### ダッシュボード
| Design の仮名 | 実アプリ | 備考 |
|---|---|---|
| `.dash-card` | `.cloud-card` | 中身は `.cloud-card-main`（本体）と `.cloud-card-chat`（申し送り） |
| `.dash-title` | `.cloud-card-name`（REF#）／`.cloud-card-memo`（メモ1行目） | **「案件名」に当たる項目は無い**（→ 4章の質問） |
| `.dash-cust` | `.cloud-kv-cust`（`<dl class="cloud-kv">` の `<dd>`） | ルート＝`.cloud-kv`の「ルート」、条件＝`.cloud-kv-tags`、サブコン＝`.cloud-kv-sub` |
| `.dash-open` | `.btn-preset-load`（文言は現状「読込」） | |
| `.dash-sub-actions` | `.cloud-card-acts` 内の `.btn-preset-preview` / `.btn-preset-pdf` / `.btn-preset-copy` / `.btn-preset-del` | `.btn-preset-del` は他メンバー作業中だと `.is-locked`（🔒・押せない） |
| `.dash-menu` / `.dash-menu-danger` | 新規（code が追加） | 「⋯」メニュー |
| `.dash-memo-badge` | `.ccc-toggle`（`.ccc-count`＝「申し送り N」、`.ccc-preview`＝最新の抜粋） | |
| `.dash-memo-body` | `.ccc-panel`（`.ccc-list`＋`.ccc-compose`） | カード側に `.cloud-card-chat.ccc-open` が付いて展開 |
| `.dash-progress` | `.quote-progress`（`.qp-bar`／`.qp-steps`／`.qp-step`） | **表示専用の `<span>`**（クリック不可） |
| `.dash-adv` | `#qpdAdv`（詳細検索）＋`#qpdAdvToggle`、`.qpd-tag-quickfilter`＋`#qpdTagChips`、`#qpdLinkModeBtn`、`.cloud-card-links`（関連案件） | |
| `.dash-ranking-cust` / `-tag` | `#qpdRankCard`（`#qpdRankPane-customer` / `#qpdRankPane-tag`）、外枠 `.qpd-side` | |

ダッシュボードの外枠：`#qpDashboard` → `.qpd-head`（`.qpd-title`、`.qpd-head-actions` ＝ `.qpd-new`「新規見積を作成」/ `.qpd-resume`「編集画面へ」）→ `#qpdStats`（ステータスのタイル）→ `.qpd-tools`（`.qpd-search`、`.qpd-tools-row` ＝ `.qpd-adv-toggle`／`.qpd-sort`／`.qpd-view-seg`／`.qpd-linkmode-btn`）→ `.qpd-body`（`.qpd-body-main` ＝ `#qpdListWrap`、`.qpd-side`）。
ログイン前は `#qpdLogin .qpd-login-card`（`.qpd-login-btn`、`.qpd-local-link`）。

### 見積入力
| Design の仮名 | 実アプリ | 備考 |
|---|---|---|
| `.rail-btn` | `.qrc-rail-btn[data-mod="…"]` | **すでに文字ラベル（`<em>`）が付いている**（3章） |
| `.rail-label` | `.qrc-rail-btn em`（既存） | |
| `.toolbar-more`（「その他 ⋯」） | **既存の `.tb-menu[data-tb-menu="more"]`**（`.tb-menu-panel`／`.tb-menu-item`）を流用 | 開閉は `toggleTbMenu('more', event)`／`closeTbMenus()` |
| `.toolbar-extra` | 新規（code が `#saveToolbar` 内の対象ボタンに付与） | |
| `data-tier` | 新規（code が付与） | 対応表は次章 |

### 区分（`data-tier`）の付け先 ― 実セレクタ案
**これは code 側の叩き台です。違和感があれば指摘してください。**

| 区分 | 付け先 |
|---|---|
| **req** | 管理番号入力：`#qf-ref`／`#qf-customer`／`#qf-person` の3つの `.quote-field`。貿易条件：`.cond-primary-bar`（インコタームズ・方向・輸送モード）、`#zone2Card`（主航路：船会社・積み地・揚げ地）。貨物：1つ目の `.cond-sub`（品名・HS）。物量：`#volumeCondGrid`。費用の表（`#section-table`）全体。下部ドック `#quoteActionDock`。固定ツールバーの「ダッシュボードに戻る」「元に戻す」「やり直す」「保存」 |
| **opt**（畳む） | 管理番号入力の残り（`#qf-received`／`#qf-due`／`#qf-date`／`#qf-valid-until`、`.quote-field-status`／`-corerf`／`-tags`／`-memo`／`-refurl`／`-attach`）。貨物：`.cond-rate-card`（関税・HS）、`#cargoRefChips`（関連知識リンク）、`#hazChips`（危険品・特殊貨物）。`#section-scope`（作業範囲）、`#section-remark`（全体リマーク）。右レール：`jump`／`fin`／`chat` |
| **adv**（かんたんでは隠す） | `#zone1Card`／`#zone3Card`（出発地・到着地ゾーン）、FCL/LCL比較（`.qrc-rail-btn[data-mod="fcllcl"]` ほか）、複数航路・往復の復路設定、サブコンのグループ操作・行パターン編集・選択モードの一括操作、右レールの `compare`／`bookmark`／`similar`／`scenario`／`subcon`／`charges`／`pattern`、固定ツールバーの「メール取込」「サブコン依頼メール」「自動保存」「表示サイズ」 |

右レールの `data-mod` は `digest`／`compare`／`fcllcl`／`bookmark`／`fin`／`chat`／`similar`／`scenario`／`subcon`／`charges`／`pattern` です。**レールは HTML を変えずに、CSS だけで区分できます**（`.qrc-rail-btn[data-mod="…"]`）。

### 実際の HTML（抜粋）
見積入力のセクション見出し（すでに畳める作り）：
```html
<div class="condition-section is-collapsible" id="section-ref">
  <h2 class="section-toggle-head" onclick="toggleQuoteSection('section-ref')">
    <span class="section-caret">▼</span>
    <span class="section-toggle-title">🗂️ 管理番号入力</span>
    <span class="section-collapsed-summary" id="sumRef"></span>
  </h2>
  <div id="refBody"> … <div class="quote-header"> <div class="quote-field"> <label>見積もり番号 <span class="req-mark">*</span></label> … </div> … </div></div>
</div>
```
セクションは `#section-ref`／`-cond`／`-cargo`／`-volume`／`-scope`／`-remark`／`-table`（本体はそれぞれ `#refBody`／`#condBody`／`#cargoBody`／`#volumeBody`／`.scope-body`／`#remarkBody`／`#tableWrap`）。

案件カード（ダッシュボード・チーム共有一覧で共通）：
```html
<div class="cloud-card cloud-card-labeled">
  <div class="cloud-card-main">
    <div class="cloud-card-row1">
      <select class="cloud-status-sel cloud-status--…"> <!-- 状態（一覧上でそのまま変更できる。他メンバー作業中は span.cloud-status-badge 🔒） -->
      <span class="cloud-card-name">10-261012-001</span>
      <button class="btn-ref-copy">…</button>
    </div>
    <div class="cloud-card-prio"> <!-- 受信から○日／料金フォロー／締切 --> </div>
    <div class="cloud-card-memo">メモの1行目</div>
    <div class="quote-progress"><div class="qp-bar"><div class="qp-fill"></div></div><div class="qp-steps"><span class="qp-step qp-done">条件</span> … </div></div>
    <dl class="cloud-kv"> <dt>ルート</dt><dd>…</dd> <dt>条件</dt><dd class="cloud-kv-tags">…</dd> <dt>サブコン</dt><dd class="cloud-kv-sub">…</dd> <dt>お客様 / 担当</dt><dd class="cloud-kv-cust">…</dd> <dt>作成 / 更新</dt><dd class="cloud-kv-who">…</dd> </dl>
    <div class="cloud-preset-tags"> <span class="cloud-tag-chip">…</span> <button class="cloud-tag-add-btn">＋ タグ</button> </div>
    <div class="cloud-card-links"> <!-- 関連案件（無いと :empty で非表示） --> </div>
    <div class="cloud-card-foot">
      <span class="cloud-card-who">🕒 10/12 09:16</span>
      <div class="cloud-card-acts"> <button class="btn-preset-preview">プレビュー</button> <button class="btn-preset-pdf">📄 PDF</button> <button class="btn-preset-load">読込</button> <button class="btn-preset-copy">📋 コピー</button> <button class="btn-preset-del">✕</button> </div>
    </div>
  </div>
  <div class="cloud-card-chat ccc-open"> <button class="ccc-toggle">…</button> <div class="ccc-panel"> <div class="ccc-list">…</div> <div class="ccc-compose">…</div> </div> </div>
</div>
```
固定ツールバー（`#saveToolbar`）の並び：ダッシュボードに戻る → ↶（`#btnQuoteUndo`）↷（`#btnQuoteRedo`）→ 📩メール取込・✉️サブコン依頼メール（`.save-btn-import`）→ 保存ラベル・💾ブラウザ保存（`.save-btn-preset`）・自動保存（`.save-toolbar-autosave`）→ 表示サイズ（`.tb-segrow`）→ ⋯（`.tb-menu`）。

## 3. 実アプリが想定と違った点（調整が楽になります）
1. **右レールには、すでに文字ラベル（`<em>`）があります。** 「アイコンだけ」なのは、ツールバーの ↶ ↷ ⋯ だけです。右下のドック（`#quoteActionDock`：PDF出力／プレビュー／保存）も、すでに文字付きです。
2. **「必須」の印（`.req-mark`＝＊）が、すでにあります**（見積番号・お客様名・担当者）。`.tier-badge` と併用か置き換えかを決めてください。
3. **ツールバーの「⋯」メニュー（`.tb-menu`）が、すでにあります。** ご提案の「その他 ⋯」はこれを拡張して作ります。
4. **見積入力画面に、進捗バー（`qp-*`）は存在しません。** `.qp-steps`／`.qp-step` は、案件カード（ダッシュボード・ブラウザ保存の一覧）の進捗バーが使っている既存のクラスです。引き渡し CSS の `.qp-steps{display:flex}` `.qp-step{…border…}` を書くと、**案件カードの進捗バーまで見た目が変わってしまいます**。見積入力の道しるべは `.qp-guide`／`.qp-guide-step` のように、別の名前にしてください。
5. **案件カードは、ダッシュボードとチーム共有の一覧（モーダル）で共通です。** かんたん表示の変更は、両方に効きます。
6. **ダッシュボードには「リスト表示」もあります**（`.qpd-list--rows`／`.qpd-rows-head`、カードより行が詰まった表）。かんたん表示でどう見せるか、案がありません。
7. **色の変数名が違います。** 引き渡し CSS の `--color-accent-900`／`--color-bg`／`--color-neutral-*` は、実アプリには定義がありません（フォールバックの16進で動くだけです）。実アプリのトークン（`--accent-dk`／`--bg` など）に寄せて取り込みます。

## 4. 追加でお願いしたいこと
**確認（回答が必要）**
- **「案件名」はどれですか。** 実アプリのカードには、①REF#（`.cloud-card-name`）、②メモ1行目（`.cloud-card-memo`）、③お客様名があります。案としては、**見出し＝メモ1行目（空なら お客様名）、REF# は小さく**としたいのですが、いかがでしょう。

**デザイン案（追加）**
1. **上級機能を使っている案件を開いたときの見せ方。** 例：往復・複数航路・FCL/LCL パターンを使う案件で、かんたん表示だと該当部分が隠れてしまいます。そのため、**上級ブロックでも、その案件が実際に使っていれば自動で表示する**方針にしました。「この案件は〇〇を使っているため表示しています」を示す小さな表示（チップや帯）の案をください。
2. **初回の案内**（「画面が新しくなりました。右上で『詳細表示』に切り替えられます」）の見た目。1回だけ表示して、閉じたら二度と出ません。
3. **ダッシュボードのリスト表示**のかんたん版（3章6）。
4. **「⋯」メニュー**の部品仕様（開いた状態・項目の並び・「削除」だけ最下段・赤字・区切り線・押した行の強調）。ツールバーの既存 `.tb-menu-panel` と見た目を揃えたい。
5. **切替スイッチ**（かんたん表示｜詳細表示）の、モバイル幅での置き場所。

## 5. こちらの進め方
1. ダッシュボード（案件カード・「⋯」メニュー・申し送りの畳み・ログイン前の2カード化・言葉の置き換え）を実装し、切替スイッチで元に戻せる状態にします。
2. 仕上がりをスクリーンショット（架空データ）で共有するので、見た目の確認をお願いします。
3. 次に見積入力画面（区分の付与・道しるべ・ツールバーの整理）を実装します。
4. 主要操作（保存・PDF・プレビュー・開く、隠した欄の保存と計算）が、かんたん表示でも通ることを確認してから、既定を「かんたん」にします。
