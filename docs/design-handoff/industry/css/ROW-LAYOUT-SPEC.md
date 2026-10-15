# 行レイアウト v3（返信06への回答）

案：`Quote Row Layout v3.dc.html`　／　CSS：`css/quote-row-stage1-industry.css`・`css/quote-row-stage2-industry.css`（どちらも v3。冒頭に v2 からの変更を書いてある）
第1・第2段階は**同じリリース**で了解。

## 決定したこと（依頼4の回答）
1. **パネルを開いている間の `.row-acts`**：**出さない**。`tr.is-detail-open` で `opacity:0; pointer-events:none`（stage2 に入れてある）。閉じれば出る。パネルを左にずらす案は採らない（操作ボタンとパネルを同時に使う場面が少ないため）。
2. **「＋n」の挙動**：**押すと「その他」のパネルを開く**。状態チップ列（`.st-state`）全体がクリック対象で、パネルの先頭「状態」に全件を並べる（`.rd-state` に `.state-chip` を再利用）。幅は、チップ 1つ（最大 74px）＋「＋n」（最小 20px）で 112px に収まる確認済み（`あえて¥0`・`出力しない`・`入力完了` で確認）。
3. **消費税の目安の置き場所**：小計の2段目（`.st-sub`）は、**外貨行＝円換算の目安／円の行＝消費税の目安**。**外貨かつ課税で両方あるときは円換算を優先**し、消費税は `title` とパネルの「金額の内訳」（`.rd-breakdown`、円換算の目安・消費税の目安）に回す。

## 実構造に合わせて直した点（2-1〜2-5）
| 指摘 | 対応 |
|---|---|
| 2-1 備考欄 | `.name-tiers` をやめ、`td.name-cell` の子を高さ固定の3段に：`input.w-name`（32px）／`.w-note-row`（備考入力＋💬 🔒 の 32px 角。3列グリッド）／`.master-actions`（32px）。**💬 🔒 はパネルに移さず2段目に残す**。`.w-note-aux`・`.note-btn` は削除 |
| 2-2 対象行 | `tr.subcon-child` → `#quoteTable > tbody > tr:not([data-virtual]):not([data-type])`。グループ表示を切っても同じ。付随行・見出し行は可変のまま |
| 2-3 補助欄 | 同一リリースで了解。**3段目＝`.master-actions`（マスターに登録／詳細）に、第2段階で「その他 ▾」を左に足す**、という理解で合っています |
| 2-4 状態チップ | 上の決定2 |
| 2-5 消費税 | 上の決定3 |

## 名前の変更（重要）
入口の名前を **「詳細 ▾」→「その他 ▾」** に変更。マスターの「詳細」ボタン（`.master-detail-jump-btn`）と同じ言葉で紛らわしいため。

## 実テンプレートとの対応（CSS だけで済む／HTML が必要）
| 場所 | CSS のみ | HTML／JS が必要 |
|---|---|---|
| カテゴリ／サブコン／パターン | `.stk` をグリッドにして `grid-row` で 見た目の順（sv → pt → cat）に並べ替え | 推奨：DOM 順も sv → pt → cat に（Tab の順が見た目と一致する。`data-col` の移動は影響なし） |
| 数量／単位 | `.qty-wrap` を縦グリッドに。`.bq-mirror` は非表示 | なし |
| 通貨（仕／売） | ラベル 16px＋選択欄のグリッド。列を **76→96px** に | `.cd-flag` を `.stk` の子として追加（`tr[data-ccy-diff="1"]` のときだけ表示） |
| 単価（仕／＋／売） | DOM 順（仕→売→CD→＋）のまま `grid-row` で 仕→＋→売 に | なし |
| 小計・利益 | — | `.st-main`／`.st-sub`／`.st-state`、`.pr-main`／`.pr-sub` の div を書き出す |
| パネル（第2段階） | 表示・位置・再表示 | `.row-detail-panel` を `td.name-cell` 内に追加し、`.w-valid`・`.row-mode-btns`・`.pct-group`・`.row-cd` を**要素ごとパネルへ移す**。「その他 ▾」を `.master-actions` の先頭に |
| 状態チップ | 見た目 | `.state-chip` を優先順で生成。`.st-state` のクリックでパネルを開く |

## パネルの構成（`.row-detail-panel` ＞ `.rd-group`）
有効期間（`.w-valid`）／状態（`.rd-state`）／単価のオプション（`.row-mode-btns`、`.pct-group`。`.wide`）／CD（`.row-cd`。通貨が違う行だけ）／金額の内訳（`.rd-breakdown`）。

## 確認したいこと
- `.w-updated` は DOM に残しつつ非表示。「サブコン／パターン見出しからまとめて設定」の機能は、見出し側のボタンを隠したことで使えなくなります。更新日の入力を、今回は見出しにも出さない方針で合っていますか。
