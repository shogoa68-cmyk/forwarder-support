# 見積明細 3階層化 仕様（Claude Design → code）

## 行の並び
```
subcon-group-header        サブコン（L0）
  subcon-subgroup-header   パターン（L1・あれば）
    subcon-cat-header      カテゴリ（L2・新規）
      subcon-child …       明細
    subcon-cat-header
      subcon-child …
  subcon-pattern-subtotal
subcon-group-subtotal
```
パターンなしのサブコンは L1 を飛ばして L0 → L2。

## 回答（code からの質問）
1. カテゴリ見出し：**表示＋折りたたみのみ**（除外・名称変更・ドラッグは付けない）。合計は、売値小計のみ。
2. 並び：**現在の並びのまま、カテゴリが変わる所で見出しを挟む**（行順は変えない）。同カテゴリを連続させたいときは既存の「⇅カテゴリ」ボタンを使う。同じカテゴリ名が離れて複数回出ても、そのつど見出しを出す。
3. パターン見出し：新しい要素は足さない。見た目のみ変更（🔖を消し、「パターン」ラベルを CSS で付ける）。✎ 📋 除外 ⇅カテゴリ 更新日は**行にカーソルを置いた時だけ表示**。

## 追加する行（仮想行）
```html
<tr data-virtual="1" data-cat-header="1" data-sv-key="a社" data-pt-key="FCL案" data-cat-key="ocean" class="subcon-cat-header">
  <td colspan="10" class="subcon-cat-cell"><div class="subcon-cat-inner">
    <button type="button" class="subcon-cat-toggle" title="折りたたみ/展開">▼</button>
    <span class="subcon-cat-label">海上運賃</span>
    <span class="subcon-cat-count">2 行</span>
    <span class="subcon-cat-sum">¥120,000</span>
  </div></td>
</tr>
```
- パターンなしは `data-pt-key=""`。カテゴリ未設定は label「（カテゴリなし）」、`data-cat-key=""`。
- ラベルは絵文字を除いたカテゴリ名（select の option 文字列から先頭の絵文字を除く）。
- 折りたたみ状態は既存のサブコン／パターンと同じ仕組みで案件ごとに保存（キー：sv-key + pt-key + cat-key）。
- 折りたたむと、次の見出し行までの `subcon-child` を非表示。
- 明細行の移動は、従来どおり同じグループ内のみ。

## 変更する見た目（CSS のみ）
- `css/quote-hierarchy-industry.css`（`quote.css` と `quote-table-industry.css` の後に読み込む）。
- サブコン：濃い鋼青の帯／パターン：淡い鋼青の帯＋左線／カテゴリ：グレーの細い帯／明細：左に階層線。
- `select.w-cat` は階層で分かるため普段は隠し、行を編集中（focus-within）だけ表示。サブコン・パターンの入力欄は、既存の「空なら隠す」ルールのまま。
- 既存の id・onclick・data-*・class は変更していない。

## 確認してほしい点
- `.w-cat` を隠しても、キーボードの Tab 移動（`data-col`）が途切れないこと（隠しているのは display:none のため、Tab は飛ばされる）。問題があれば、隠さず幅を縮める。

- 列見出し「カテゴリ／サブコン」は CSS で「サブコン／パターン」表記に見せている。HTML 側の文言を直接変えられるなら、そちらが望ましい。
