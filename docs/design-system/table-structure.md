# 見積明細の表の構造（実際のマークアップ）

見積入力画面の明細の表が、実際にどんな行・HTML で作られているかの説明です。表の見た目（特に見出し行）を改良するときの前提として読んでください。
表は JavaScript が組み立てており、見出し行や小計行は**画面表示用の仮想行**（`data-virtual="1"`）です。

## 行の並び（実際の例）
サブコン A社（パターン「FCL案」「LCL案」）と B社（パターンなし）の例：

```
subcon-group-header（仮想行）
subcon-child
subcon-subgroup-header（仮想行）
subcon-child
subcon-pattern-subtotal（仮想行）
subcon-group-subtotal（仮想行）
subcon-group-header（仮想行）
subcon-child
subcon-group-subtotal（仮想行）
row(明細行)
```

階層は **サブコン › パターン › 明細** の 3 段です。サブコンが 1 社だけでも、パターンがあれば同じ構造になります。
**カテゴリ（海上運賃・通関 など）の見出し行は、入力画面の表には現在ありません**。カテゴリは各明細行の選択欄（`cat-<行ID>`）です。
一方、御見積書（PDF）側には、サブコン › パターン › カテゴリ › 明細 の 4 段の階層があり、カテゴリ見出し行（`.qd-cat-head`）があります。

## 各行のマークアップ
### サブコン見出し行（`tr.subcon-group-header`）
```html
<tr data-virtual="1" data-sv-key="a社" data-sv-label="A社" class="subcon-group-header" draggable="false" style="--grp-accent: #b0772f;"><td colspan="10" class="subcon-group-header-cell"><div class="subcon-group-header-inner"><span class="subcon-group-grip" title="ドラッグでグループ（ブロック）を並び替え">⠿</span><button type="button" class="subcon-group-toggle" title="折りたたみ/展開">▼</button><input type="checkbox" class="subcon-group-chk" title="このサブコンの全明細を選択／解除（一部だけ選択中は中間表示）"><span class="subcon-group-label">📦 A社</span><span class="subcon-group-count">2 行</span><span class="subcon-group-sum" title="">¥120,000</span><button type="button" class="subcon-group-excl" title="見積もりへの含める/除外を切り替え">除外</button><button type="button" class="subcon-group-add-btn" data-sv="A社" title="A社 に行を追加">＋</button><button type="button" class="subcon-group-sort-btn" title="このグループ内をカテゴリ順に並び替え">⇅カテゴリ</button><span class="grp-updated" title="このグループの最終更新日（社内管理用・客先出力には含まれません）。設定すると配下の全行に反映されます。"><span class="grp-updated-lbl">🕒 更新</span><input type="date" class="grp-updated-input"><button type="button" class="grp-updated-today" title="今日に一括設定">今日</button><span class="grp-updated-mixed" style="display:none">混在</span></span></div></td></tr>
```

### パターン見出し行（`tr.subcon-subgroup-header.is-pattern`）
```html
<tr data-virtual="1" data-sub-group="1" data-sv-key="a社" data-pt-key="LCL案" class="subcon-subgroup-header is-pattern" draggable="false"><td colspan="10" class="subcon-subgroup-cell"><div class="subcon-subgroup-inner"><span class="subcon-subgroup-grip" title="ドラッグでこのパターンを並び替え（同じサブコン内のみ）">⠿</span><button type="button" class="subcon-subgroup-toggle" title="折りたたみ/展開">▼</button><input type="checkbox" class="subcon-group-chk" title="このパターンの全明細を選択／解除（一部だけ選択中は中間表示）"><span class="subcon-subgroup-leg">🔖 LCL案</span><button type="button" class="subcon-subgroup-rename" title="このパターン名を変更（配下の行すべてに反映）">✎</button><button type="button" class="subcon-subgroup-dup" title="このパターンの明細行をすべて複製（新しいパターンとして「（2）」等が付きます）">📋</button><button type="button" class="subcon-subgroup-excl" title="見積もりへの含める/除外を切り替え">除外</button><button type="button" class="subcon-group-sort-btn" title="このパターン内をカテゴリ順に並び替え">⇅カテゴリ</button><span class="grp-updated" title="このグループの最終更新日（社内管理用・客先出力には含まれません）。設定すると配下の全行に反映されます。"><span class="grp-updated-lbl">🕒 更新</span><input type="date" class="grp-updated-input"><button type="button" class="grp-updated-today" title="今日に一括設定">今日</button><span class="grp-updated-mixed" style="display:none">混在</span></span></div></td></tr>
```

### パターン小計行（`tr.subcon-pattern-subtotal`）
```html
<tr data-virtual="1" data-pt-sum="1" data-sv-key="a社" data-pt-key="LCL案" class="subcon-pattern-subtotal"><td colspan="10" class="subcon-pattern-subtotal-cell"><div class="subcon-subtotal-inner subcon-subtotal-inner--pt"><span class="subcon-subtotal-label">↳ 🔖 LCL案 小計</span><span class="st-metric st-cost"><i>仕入合計</i><b class="subcon-subtotal-cost" title="">¥0</b></span><span class="st-metric st-sell"><i>売値合計</i><b class="subcon-subtotal-sum" title="">¥0</b></span><span class="st-metric st-margin"><i>粗利率</i><b class="subcon-subtotal-margin">—</b></span><button type="button" class="subcon-subtotal-add-btn subcon-pt-add-btn" data-sv="A社" data-pt="LCL案" title="LCL案 に行を追加（このパターン末尾）">＋ 行追加</button><span class="st-remark" title="このパターンに関する注記。「見積書に表示」がONの間だけ客先向け出力（プレビュー・御見積書PDF・メール）にも表示されます。"><i>📝 パターン別リマーク</i><input type="text" class="subcon-remark-input" placeholder="このパターンへの注記（任意）"><button type="button" class="subcon-remark-toggle is-shown" title="クリックで見積書には表示しない（社内用）にする">📄 見積書に表示</button></span></div></td></tr>
```

### サブコン小計行（`tr.subcon-group-subtotal`）
```html
<tr data-virtual="1" data-sv-key="a社" data-sub-sum="1" class="subcon-group-subtotal" style="--grp-accent: #b0772f;"><td colspan="10" class="subcon-group-subtotal-cell"><div class="subcon-subtotal-inner"><span class="subcon-subtotal-label">↳ A社 小計</span><span class="st-metric st-cost"><i>仕入合計</i><b class="subcon-subtotal-cost" title="">¥100,000</b></span><span class="st-metric st-sell"><i>売値合計</i><b class="subcon-subtotal-sum" title="">¥120,000</b></span><span class="st-metric st-margin"><i>粗利率</i><b class="subcon-subtotal-margin">16.7%</b></span><span class="st-alias" title="客先向け出力（プレビュー・御見積書PDF）で、この小計の「A社」をここに入力した名前へ置換します。空欄ならサブコン名のまま。"><i>客先表示名</i><input type="text" class="subcon-alias-input" placeholder="例）国内諸費用 一式（任意）"></span><button type="button" class="subcon-subtotal-add-btn" title="A社 に行を追加（このサブコン末尾）">＋ 行追加</button><span class="st-remark" title="このサブコンに関する注記。「見積書に表示」がONの間だけ客先向け出力（プレビュー・御見積書PDF）にも表示されます。"><i>📝 サブコン別リマーク</i><input type="text" class="subcon-remark-input" placeholder="このサブコンへの注記（任意）"><button type="button" class="subcon-remark-toggle is-shown" title="クリックで見積書には表示しない（社内用）にする">📄 見積書に表示</button></span></div></td></tr>
```

### 明細行（`tr#row-<ID>`、仮想行ではない）
```html
<tr id="row-1" class="subcon-child" draggable="false" style="--grp-accent: #b0772f;" data-excluded="">
<td class="check-cell">
<input type="checkbox" class="row-select-chk" tabindex="-1" title="この行を選択（コピー・削除用）" style="width:13px;height:13px;cursor:pointer;margin:0;">
</td>
<td class="handle-cell">
<span class="drag-handle" title="ドラッグして並び替え">⠿</span>
<!-- コンテナ本数連動アイコンは一旦 UI から非表示（機能・JSロジックは残置：window.toggleCntLink / _syncContainerLinkedRows / cntLink 復元）。 再表示する場合は以下のボタンを戻すこと： <button class="cnt-link-btn" onclick="window.toggleCntLink?.(this)" title="コンテナ本数に数量を連動（FCL）" tabindex="-1">⛓</button> -->
<div class="row-acts">
<button class="row-hidequote-btn" onclick="window.toggleRowHideQuote?.(this)" title="この行を見積書（プレビュー客先表示・PDF・Excel・CSV）に出力しない" tabindex="-1">👁</button>
<button class="row-pending-btn" onclick="window.toggleRowPending?.(this)" title="後で調べて記入（要調査マーク）。サーチャージ等、最新情報を調べてから埋める項目に。" tabindex="-1">🔍</button>
<button class="row-done-btn" onclick="window.toggleRowDone?.(this)" title="入力完了の目印。作成を再開したとき、どこまで終わったか分かります（もう一度クリックで解除）。" tabindex="-1">✓</button>
<button class="row-add-btn" onclick="window.rowAddBelow?.(this)" title="この行の直下に新しい行を追加" tabindex="-1">➕</button>
<button class="row-dup-btn" onclick="window.rowDuplicate?.(this)" title="この行を複製して直下に挿入" tabindex="-1">📋</button>
<button class="row-del-btn" onclick="window.rowDelete?.(this)" title="この行を削除" tabindex="-1">🗑️</button>
</div>
</td>
<td class="catsv-cell stk-cell">
<div class="stk">
<select class="w-cat" data-field="cat" data-col="0" id="cat-1"><option value="" selected="">— カテゴリ —</option><option value="domestic">🏠 国内作業</option><option value="export-local">📤 輸出ローカルチャージ</option><option value="ocean">🚢 海上運賃</option><option value="air">✈️ 航空運賃</option><option value="surcharge">⚡ サーチャージ</option><option value="import-local">📥 輸入ローカルチャージ</option><option value="overseas">🌏 海外作業</option><option value="customs-export">🛃 通関諸費用（輸出）</option><option value="customs-import">🛃 通関諸費用（輸入）</option><option value="insurance">🛡️ 保険料</option><option value="domestic-transport">🚚 国内配送・横持ち</option><option value="warehouse">📦 倉庫保管</option><option value="packing-cost">🎁 梱包</option><option value="other">📋 その他</option></select>
<input type="text" data-field="sv" class="w-subcon" placeholder="サブコン" list="svSuggestions" id="sv-1">
<input type="text" data-field="pt" class="w-pattern" placeholder="パターン（任意）" title="サブコン内をさらに分けるパターン名（任意）。同じパターン名の行がサブコン配下で入れ子のグループ・小計になります。" id="pt-1">
</div>
</td>
<td class="name-cell">
<input type="text" data-field="nm" class="w-name" placeholder="例）海上運賃" data-col="1" list="nmSuggestions" id="nm-1">
<div class="w-note-row">
<input type="text" data-field="nt" class="w-note" placeholder="備考（任意）" data-col="6" id="nt-1">
<button type="button" class="btn-row-rem" tabindex="-1" title="備考欄のテキストを引用して直下に備考行を挿入（空でも可）">💬</button>
<button type="button" class="btn-row-int" tabindex="-1" title="備考欄のテキストを引用して直下に社内メモを挿入（空でも可）">🔒</button>
</div>
<div class="w-valid" title="サーチャージ適用期間。開始日のみ／終了日のみも可。見積もり提示日（＝見積全体の有効期限。未設定なら発行日→今日）がこの期間を外れると、その行は客先見積もり・PDF・Excel・CSV・合計から自動的に除外されます（社内モードではグレー表示）。">
<span class="w-valid-lbl">有効</span>
<input type="date" data-field="vf" class="w-valid-date" title="適用開始日（終了日なしでも保存・表示されます）" id="vf-1">
<span class="w-valid-sep">〜</span>
<input type="date" data-field="vt" class="w-valid-date" title="適用終了日（省略可）" id="vt-1">
</div>
<div class="w-updated" title="この行の最終更新日（社内管理用・客先出力には含まれません）。サブコン／パターン見出しからまとめて設定もできます。">
<span class="w-updated-lbl">🕒 更新</span>
<input type="date" data-field="lu" class="w-updated-date" id="lu-1">
</div>
</td>
<td class="qty-cell">
<div class="qty-wrap">
<input type="number" data-field="pq" class="w-qty" min="0" data-col="2" title="" id="pq-1">
<input type="text" list="unit-list" data-field="un" class="w-unit" data-col="2u" placeholder="単位" id="un-1">
</div>
<input type="number" data-field="bq" tabindex="-1" readonly="" class="bq-mirror" id="bq-1">
</td>
<td class="ccy-cell stk-cell">
<div class="stk">
<span class="stk-cost"><span class="stk-tag t-cost">仕</span><select data-field="pc" class="w-cur" data-col="3" id="pc-1"><option value="JPY" selected="">JPY</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="CNY">CNY</option><option value="KRW">KRW</option><option value="SGD">SGD</option><option value="HKD">HKD</option><option value="GBP">GBP</option><option value="AUD">AUD</option><option value="TWD">TWD</option><option value="THB">THB</option><option value="VND">VND</option><option value="MYR">MYR</option><option value="IDR">IDR</option><option value="PHP">PHP</option><option value="INR">INR</option></select></span>
<span class="stk-sell"><span class="stk-tag t-sell">売</span><select data-field="bc" class="w-cur w-cur-sell" data-col="3b" title="売値の通貨。仕入通貨と別にする場合はここで変更（売単価を直接入力できます）" id="bc-1"><option value="JPY" selected="">JPY</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="CNY">CNY</option><option value="KRW">KRW</option><option value="SGD">SGD</option><option value="HKD">HKD</option><option value="GBP">GBP</option><option value="AUD">AUD</option><option value="TWD">TWD</option><option value="THB">THB</option><option value="VND">VND</option><option value="MYR">MYR</option><option value="IDR">IDR</option><option value="PHP">PHP</option><option value="INR">INR</option></select></span>
</div>
</td>
<td class="price-cell stk-cell">
<div class="stk stk-price">
<span class="stk-cost">
<span class="stk-tag t-cost">仕</span>
<input type="number" data-field="pp" class="w-price" min="0" data-col="4" id="pp-1">
<span class="pct-group">
<input type="number" data-field="pprate" class="w-pct-rate" min="0" step="0.01" placeholder="%" title="%率（例: 0.3 → 0.3%）" id="pprate-1">
<span class="pct-x">%×</span>
<select class="w-ppref" title="参照行（選択するとその行の仕入単価を基準額として使用。変更されると自動再計算）" id="pprefsel-1"><option value="">—</option></select>
<input type="number" data-field="ppbase" class="w-pct-base" min="0" placeholder="基準額" title="基準金額（例: CIF価格・保険価格など。仕入通貨と同じ通貨で入力）" id="ppbase-1">
</span>
</span>
<span class="stk-sell"><span class="stk-tag t-sell">売</span><input type="number" data-field="bp" class="w-price display-field" tabindex="-1" readonly="" data-base="100000" id="bp-1"><small class="bp-base-hint" hidden="" title="仕入単価を売通貨へ換算した正確な金額（端数切り捨て前）です。これを下回る売単価にすると赤字になります。※このライン自体が仕入通貨と売通貨の為替レートに基づく目安であり、実際のレートと差が出る場合があります"></small></span>
<span class="row-cd"><span class="row-cd-lbl" title="Currency Difference（通貨差調整値）">CD</span><input type="text" data-field="cd" class="w-cd display-field" placeholder="—" tabindex="-1" readonly="" id="cd-1"></span>
<span class="stk-mk"><span class="stk-mk-plus" title="乗せ幅（仕入単価に加算 → 売単価）">＋</span><input type="number" data-field="mk" class="w-mkup" min="0" data-col="5" title="乗せ幅：仕入単価に加算して売単価になります" id="mk-1"></span>
</div>
<input type="hidden" data-field="zc" id="zc-1">
<input type="hidden" data-field="ac" id="ac-1">
<input type="hidden" data-field="ps" id="ps-1">
<input type="hidden" data-field="co" id="co-1">
<input type="hidden" data-field="ri" id="ri-1">
<input type="hidden" data-field="ppmode" id="ppmode-1">
<input type="hidden" data-field="uid" id="uid-1">
<input type="hidden" data-field="ppref" id="ppref-1">
<input type="hidden" data-field="es" id="es-1">
<div class="row-mode-btns">
<button type="button" class="zero-confirm-btn" tabindex="-1" title="0円確認済みにする（もう一度クリックで解除）">¥0✓</button>
<button type="button" class="actual-cost-btn" tabindex="-1" title="実費（金額未確定・別途精算）。単価・金額に「実費」と表示し、合計から除外します（もう一度クリックで解除）。">実費</button>
<button type="button" class="profit-share-btn" tabindex="-1" title="PROFIT SHARE（代理店収益）。客先見積もりには出さず、社内の利益・粗利率にのみ計上します（もう一度クリックで解除）。">PS</button>
<button type="button" class="cond-charge-btn" tabindex="-1" title="発生時のみ／必要時のみ請求。金額は客先にも表示しますが、見積もり合計には加算しません（もう一度クリックで解除）。">都度</button>
<button type="button" class="ref-info-btn" tabindex="-1" title="参考情報。金額は客先にも表示しますが、見積もり合計には加算しません。「都度（発生時のみ請求）」とは別に、参考として提示したい行に使用します（もう一度クリックで解除）。">参考</button>
<button type="button" class="est-btn" tabindex="-1" title="概算（金額は目安）。単価・金額の前に「約」を付けて表示します。見積もり合計には通常どおり加算されます（もう一度クリックで解除）。">概算</button>
<button type="button" class="pct-mode-btn" tabindex="-1" title="仕入単価を「○○の何%」として計算（%率と基準額を入力）。もう一度クリックで直接入力に戻す。">%</button>
<button type="button" class="master-reg-btn" tabindex="-1" title="この行をマスター登録：品名（単位・備考・カテゴリ・代表単価）＋サブコンを登録し、次回同名入力時に自動入力・参考価格として活用します。">📇 登録</button>
<button type="button" class="master-detail-jump-btn" tabindex="-1" hidden="" title="この品名のマスター詳細を見る・マスター管理タブの該当行へジャンプ">📇 詳細</button>
</div>
<span class="actual-cost-badge" aria-hidden="true">実費</span>
</td>
<td class="tax-cell"><input type="checkbox" data-field="tx" title="ON にすると消費税 10% が自動計算され、項目名先頭に「*」が付きます。免税（非課税）の行は OFF のままにしてください。" id="tx-1"></td>
<td class="subtotal-cell subtotal-has-value" data-field="st" id="st-1">120,000</td>
<td class="profit-cell profit-pos" data-field="pr" id="pr-1">20,000</td>
</tr>
```

## 動作と制約（変えると機能が壊れるもの）
- **見出し行・小計行は仮想行**です。保存データ・CSV/Excel/PDF には含まれません。表を再描画するたびに作り直されます。
- 見出し行の操作：折りたたみ（▼/▶）、除外/含む（合計から外す）、名称変更（✎）、複製、グリップ（⠿）のドラッグによるブロックの並べ替え。
  これらは `data-sv-key`・`data-pt-key` などの `data-*` と、ボタンの `onclick` で機能とつながっています。
- 明細行の移動（ドラッグ・↑↓）は**同じグループ内のみ**です。
- 折りたたみ・除外の状態は案件ごとに保存されます（物量パターンごとの記憶もあります）。
- 見出し行の列は `colspan="10"` です（表の列数に合わせてあります）。

## コードの場所（共有が必要な場合の目安）
- `js/quote/row.js` の `renderSubconGroups()`：サブコン見出し行・パターン見出し行・各小計行を作る関数（HTML の文字列で組み立て）。
- 見た目は `css/quote.css` の `.subcon-group-header`・`.subcon-subgroup-header`・`.subcon-*` 系のクラス。

## 見出し行を変更・追加するときに決めておきたいこと（Claude Design へのお願い）
1. 目的の見た目（HTML と CSS）。使うクラス名・`data-*` を指定してもらえれば、そのまま反映します。
2. カテゴリ見出し行を追加する場合：表示のみか、折りたたみ・除外もできるか。同じカテゴリの明細を連続して並べる（並び順を変える）のか、現在の並びのまま、カテゴリが変わるところで見出しを挟むのか。
3. 既存の `id`・`onclick`・`data-*` は残します（部品名の自動チェックで確認します）。
