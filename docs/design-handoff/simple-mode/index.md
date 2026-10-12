# code への引き渡し

## 差し替えるもの（css/）
- tokens.css / tokens-doc.css / style.css / quote.css / quote-pdf.css … Industry 値に置き換え済み（変数名・class・id は同じ）
## 追加するもの（css/）
- quote-table-industry.css / quote-hierarchy-industry.css / blueprint-industry.css
## 読み込み順
tokens.css → style.css → quote.css → quote-table-industry.css → quote-hierarchy-industry.css → blueprint-industry.css
## JS の作業
- css/HIERARCHY-SPEC.md のとおり、renderSubconGroups() にカテゴリ見出し行（tr.subcon-cat-header）を追加
## 参考
- MIGRATION.md（色の新旧対応）/ README.md

---

# かんたん表示（Simple Mode）の引き渡し

## 追加ファイル
- css/simple-mode-industry.css（新規。quote-hierarchy-industry.css の後に読み込む）
- css/SIMPLE-MODE-SPEC.md（仕様：区分表、HTML/JS の変更点、言葉の置き換え）
- 見た目の確認用：Simple Mode.dc.html（プロジェクト側。見積入力／ダッシュボード／ログイン前）

## 切替の仕組み
- <html class="mode-simple"> が付いていれば「かんたん」。外せば「詳細」。既定はかんたん。
- 保存：localStorage の fwd.uiMode（simple | detail）。
- 隠す欄は display:none のまま DOM に残す。data-tier="req"（必須）は隠さない。

## code 側の作業（CSS だけでは不可）
1. 各ブロックに data-tier="req|opt|adv" を付ける（区分表は SPEC 参照）。
2. opt のブロックを <details data-tier="opt"><summary>…</summary>…</details> にする。
3. 見積入力の道しるべ qp-* を 4 段（① 条件 → ② 貨物 → ③ 費用 → ④ 出力）にし、現在の段に .is-current。直下に「いまは①。次は…」の一文。
4. 固定ツールバー・右レール：アイコンだけのボタンに .rail-label で文字を添える。普段使わないものに .toolbar-extra を付け、かんたんでは「その他 ⋯」（.toolbar-more）にまとめる。項目は元ボタンの onclick を呼ぶ。
5. ダッシュボードの案件カード：案件名（大）／お客様・担当／ルート／進捗（表示専用）／「開く」／「⋯」（プレビュー・PDF・コピー・削除＝最下段・赤字）。申し送りは .dash-memo-body を既定で閉じ、件数バッジで開閉。
6. ログイン前：「ログインして使う」と「ログインせずに使う」の2カード化。
7. 言葉の置き換え：読込→開く／編集画面へ→作業中の見積に戻る／ブラウザ保存→この端末に保存 ほか（SPEC 参照）。

## Design から code への質問
1. data-tier、.dash-card、.rail-btn、.toolbar-extra などの class 名は仮の名前。実アプリの class 名を教えてほしい（CSS を合わせて書き直す）。
2. 見積入力の「貿易条件」「貨物」「費用」「出力」各ブロックの HTML（id と class）を共有してほしい。
3. 「⋯」メニューの動作（開閉、外側クリックで閉じる、キーボード操作）は code 側の実装でよいか。

## 確認してほしい点
- かんたん表示でも、必須項目と主要操作（保存・PDF・プレビュー・開く）が通ること。
- 隠した欄の値が、保存と計算で今までどおり読まれること。

---

# 返信（02）への回答：追加分

## 追加ファイル
- css/SIMPLE-MODE-ADDENDUM.md（回答・部品仕様）
- preview/Simple Mode Extras.dc.html（見た目の確認用。プロジェクトの _ds/ を読むため、zip 単体ではスタイルが崩れる）

## 回答の要点
- **案件名 ＝ メモ1行目（.cloud-card-memo）**。REF# は状態タグの隣に小さく、お客様名は2行目（13px）。メモが空ならルート、それも空なら REF#。
- 上級機能を使う案件：隠した adv 項目に値があるときだけ、上部の帯＋点線チップで知らせる。
- 初回の案内：スイッチを指す吹き出し。どのボタンでも1回で消える（fwd.uiHintSeen=1）。
- リスト表示（かんたん）：7列（状態／案件名／お客様／ルート／更新日／開く／⋯）。
- 「⋯」メニュー：40px 行、削除だけ最下段・赤字・上に墨色の区切り線。.is-locked は薄い色＋理由1行。
- モバイル：ヘッダー直下に全幅の2分割（高さ48px以上）。見積入力はツールバーの外に置く。
- 色の変数名：フォールバックの16進値をそのまま使ってよい。
- .req-mark（＊）：置き換えず併用でよい。＊は小さな補助、.tier-badge「必須」は見出し側。（code の判断で、どちらか一方に統一しても可）
