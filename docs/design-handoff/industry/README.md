# フォワーダー支援 デザインシステム（Industry 版）

Industry（鋼青のブループリント調）へ移行済みです。配色・書体・角丸は CSS 変数の値を置き換えて反映しています。変数名・class・id は変えていません。

## 見た目の方針
- 配色：薄いグレーの地（`--bg` #f2f2f3）に、鋼青のアクセント1色（`--accent` #5980a6）。意味色（赤・琥珀）は低彩度。緑は使わず鋼青に統一。
- 書体：見出し Barlow Condensed、本文 Barlow、日本語 Noto Sans JP。
- 角：すべて四角（`--r-*` は 0、`--r-pill` は 2px、円形のみ 50%）。
- 入力欄：白地＋細いグレー枠。フォーカスで鋼青の枠。

## ファイル
| ファイル | 内容 |
|---|---|
| `css/tokens.css` | サイト画面の色・書体・角丸（Industry 値） |
| `css/tokens-doc.css` | 御見積書の色・書体（Industry 値） |
| `css/style.css` `css/quote.css` `css/quote-pdf.css` | 色・角丸・書体を置き換えたもの |
| `css/quote-table-industry.css` | 見積明細の表の整理（横罫のみ、操作ボタンはホバー表示、補助情報は編集中のみ） |
| `css/quote-hierarchy-industry.css` | サブコン › パターン › カテゴリ › 明細 の3階層表示 |
| `css/blueprint-industry.css` | 「+」登録マーク（.card / .btn-primary / 明細表の外枠。HTML 変更なし） |
| `css/HIERARCHY-SPEC.md` | 3階層化の仕様（code への依頼内容） |
| `css/MIGRATION.md` | 色の新旧対応表 |
| `css/*-legacy.css` | 移行前の版 |

読み込み順：`tokens.css` → `style.css` → `quote.css` → `quote-table-industry.css` → `quote-hierarchy-industry.css`

## デザイン確認用
- `Quote Document*.dc.html`：御見積書（日本語・英語・FCL/LCL 併記）
- `Quote Table.dc.html`：明細の3階層レイアウト案
- `cards/`：見本カード（`components-table-clean.html` `components-table-hierarchy.html` が表の整理版）

## 未対応
- 「+」印は .card / .btn-primary / 明細表の外枠のみ（疑似要素で枠の内側に描画）。他の部品は要望があれば追加。
- カテゴリ見出し行（`tr.subcon-cat-header`）は、code 側の JS 対応待ち。
- 御見積書・サイト画面の、実アプリでの最終確認。

## 変更時の約束
従来どおり、`id`・`onclick`・`data-*`・JS が付け外しする class は残す。御見積書は A4・`break-inside` を保ち、日本語・英語の両方で崩れないこと。
