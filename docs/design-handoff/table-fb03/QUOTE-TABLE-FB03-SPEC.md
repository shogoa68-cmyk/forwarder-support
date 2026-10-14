# 見積テーブル フィードバック03（7件）への回答

デザイン案：`Quote Table Fixes.dc.html`　／　CSS：`css/quote-table-fb03.css`（読み込みは最後）

## 結論の一覧
| # | 回答 | CSS だけで可？ |
|---|---|---|
| 1 | 単位の列を **112px** に決める。数量 64px ＋ 単位 112px、qty-cell は 194px。縦積みには戻さない。さらに長い自由入力は title で全文表示 | CSS＋JS 1行（title） |
| 2 | 仕・＋・売を **幅100%／高さ32px／13px** に統一。売は「点線枠＋灰地＋太字」で入力不可を示す | CSS |
| 3a | フラグ群は文言変更＋折り返しても切れない並び（ボタン 28px・nowrap・gap 6px） | 文言は HTML/JS、並びは CSS |
| 3b | 「登録／詳細」は **品名セルの下**へ移す。呼び名は「マスターに登録」「マスター登録済み　詳細 ›」 | HTML の移動が必要 |
| 4 | チェック36px／つまみ32px を別列に固定。`.row-acts` は **行の下に重ねる**（行の高さを変えない）。3×2・文字付き | CSS＋HTML（ラベル span） |
| 5 | `tr.subcon-child`・`tr.subcon-subchild` のセル `::before`／`::after` を削除 | CSS |
| 6 | 見出し：左＝つまみ・矢印・チェック・名称・行数／中＝操作（名称の右に左寄せ）／右＝金額。パターン・カテゴリ見出しも同じ並び | CSS（`order`）。操作を包む要素があるとより確実 |
| 7 | 全体合計：濃い鋼青の帯、売値28px太字・仕入と粗利16px。マイナス時は赤地白字＋「赤字」の文字 | CSS（クラス名の確認が必要） |

## 3 の文言変更：対象一覧
| 対象 | 現在 | 変更後 |
|---|---|---|
| ボタン `.zero-confirm-btn` | ¥0✓ | あえて¥0 |
| バッジ `.zero-confirmed-badge` | ¥0 ✓ | あえて¥0 |
| ボタン `.cond-charge-btn` | 都度 | 必要時 |
| そのツールチップ（title） | 発生時のみ／必要時のみ請求 ほか | 「必要時のみ請求」に統一 |
| 参考情報の説明文 | 参考情報（都度…） | 参考情報（必要時…） |
| ボタン `.master-reg-btn` | 📥 登録 | マスターに登録（絵文字は外してよい） |
| ボタン `.master-detail-jump-btn` | 📇 詳細 | マスター登録済み　詳細 ›（CSS の ::before で前半を付けている。HTML の文言は「詳細」のまま） |
| 客先向け出力の「都度請求」 | — | 今回は対象外。code 側で整合を確認 |

## HTML／JS が必要な箇所（CSS では実現できない）
1. **3b**：`.master-reg-btn`／`.master-detail-jump-btn` を `td.price-cell .row-mode-btns` から `td.name-cell` の下へ移す。
   ```html
   <td class="name-cell">
     …品名・備考…
     <div class="master-actions">
       <button class="master-reg-btn" …>マスターに登録</button>
       <button class="master-detail-jump-btn" hidden …>詳細</button>
     </div>
   </td>
   ```
   `hidden` の出し分けと `onclick` はそのまま（要素ごと移すだけ）。
2. **4**：`.row-acts` の各ボタンに文字ラベルを追加：見積書に出さない／要調査／入力完了／直下に追加／複製／削除。`<span class="row-act-label">…</span>`。絵文字は残してよい。
3. **4**：`td.check-cell` と `td.handle-cell` が別セルであることの確認（実画面では `.row-acts` がチェックと重なっているため、`.row-acts` が `td.handle-cell` の中にあり、かつ `position:absolute` で動くようにしてある）。
4. **1**：`.w-unit` の `input` イベントで `title = value`。
5. **6（推奨）**：サブコン見出しの操作類を `<span class="subcon-group-actions">` で包む。包めない場合も CSS の `order` で並ぶ。
6. **7**：合計行のセルに `.tot-label`／`.tot-sell`／`.tot-cost`／`.tot-profit`／`.tot-rate` を付ける（無ければ追加）。

## 質問への回答（確認ありがとうございます）→ v2 で反映済み
- `.profit-neg`／合計行の実 class・id／`.row-acts` の位置：了解。CSS を実セレクタ（`#tot-row-label`、`td.tot-amt-cell`、`#tot-cost`、`#tot-subtotal`、`td#tot-profit`、`.tot-margin`）に差し替えました。

## 取り込みで出た5点への回答（v2 の CSS に反映）
1. **合計行のインライン指定**：整理できるなら、セルの `style=` の `background`／`font-weight`／色を外すのが本筋。難しければ v2 は `!important` で勝つ書き方にしてあります（外せたら !important も外してください）。
2. **単価欄**：直下の子すべてをグリッドにするのをやめ、`.stk-cost`／`.stk-sell`／`.stk:has(> .w-mkup)` の行だけを「20px＋1fr」にしました。`.pct-group`／`.w-pct` は2列目に置きます。% モードで崩れたら、その行の class を教えてください。
3. **最終行で切れる**：最終3行は上向きに出す（`:nth-last-child(-n+3)`）。JS で余白を測れるなら、`tr.is-flip` を付ける方が確実（付いていれば優先）。
4. **タッチ**：`@media (hover:none)` で、見出しの操作は常に表示。行の操作は行のタップで `tr.is-active`（JS）を付けて表示。つまみと操作ボタンは 44px 以上。
5. **Industry 専用**：その方針でお願いします。変えないもの（1・2・4・6・7のレイアウト）は Industry 層に、両テーマで変えるもの（文言、登録／詳細の移動、ラベル追加）は共通側に。

## 進め方
ご提案の 1→2→3 の順で進めてください。実装前後の画像を見せてもらえれば、見た目の確認をします。「都度請求」の客先向け出力は今回対象外で了解です。
