# Supabase 適用台帳（SQL を Supabase に渡したか／まだか）

Supabase の SQL Editor に貼って実行する SQL を、**渡した／まだ渡していない**で管理する台帳。

## 使い方（かんたん）
1. 新しく SQL を作ったら、Claude が下の「**① このセッションで集めた SQL**」に **未渡し** で追加する。
2. あなたが Supabase の SQL Editor で実行したら、Claude に「○○ を渡した」と伝える（または自分でこの表を直す）。
3. Claude は状態を **渡し済み**（日付つき）に書き換える。
4. 「渡していない SQL を出して」と言えば、未渡しだけを 1 つにまとめて貼り付け用に出す。

状態の言葉：**未渡し**＝まだ実行していない／**渡し済み**＝実行した／**不明**＝過去分で、実行したか分からない（確認待ち）

## ① このセッションで集めた SQL（2026-11-12 開始）

| 状態 | ファイル | 何のための SQL か | 渡した日 | メモ |
|---|---|---|---|---|
| （まだありません） | | | | |

## ② 過去に作った SQL（実行したか不明・確認待ち）

実行済みのものは「渡し済み」に直してください（全部の再実行は不要）。ほとんどは「何度実行しても安全」と書いてありますが、念のため。

| 状態 | ファイル | 何のための SQL か | 渡した日 |
|---|---|---|---|
| 不明 | `docs/sql/admin-edit-creator.sql` | 【一時措置】管理者が見積（案件）の「作成者」を変更する | |
| 不明 | `docs/sql/alias-rules-add-customer.sql` | エイリアス是正の対象に「お客様(customer)」を追加するためのマイグレーション。 | |
| 不明 | `docs/sql/announcements.sql` | 📢 管理者からメンバーへの「お知らせ」 | |
| 不明 | `docs/sql/bookmark-clicks.sql` | bookmark_clicks: ブックマーク（チップ）のクリック数の記録・集計 | |
| 不明 | `docs/sql/bookmarks-files.sql` | bookmarks: ファイル添付（Storage）対応 | |
| 不明 | `docs/sql/bookmarks-migration.sql` | bookmarks 全面クラウド移行 ＋ 編集履歴（トリガー自動記録）  フェーズ1 | |
| 不明 | `docs/sql/bookmarks-update-policy.sql` | bookmarks: UPDATE 用 RLS ポリシーの追加（編集が保存されない不具合の修正） | |
| 不明 | `docs/sql/bookmarks-verifications.sql` | bookmarks: リンク確認（人による「確認済み」記録）テーブル | |
| 不明 | `docs/sql/calendar-migration.sql` | カレンダータブ：祝日・サーチャージ適用日 テーブル ＋ 編集履歴 | |
| 不明 | `docs/sql/carrier-contacts.sql` | carrier_contacts: 船会社／LCLキャリアの連絡先（担当者を複数登録可） | |
| 不明 | `docs/sql/carrier-relations.sql` | carrier_relations: 会社間の関係性登録（代理店関係など・統合ではない） | |
| 不明 | `docs/sql/carrier-sv-migration-count.sql` | キャリア → サブコン 統合（段階 2）の前に、影響範囲を数える（読み取りだけ。何も変更しない） | |
| 不明 | `docs/sql/cp-events.sql` | サイバーポート Webhook：受け取った通知の保存先 cp_events | |
| 不明 | `docs/sql/cp-watch.sql` | 🚢 サイバーポート：動静の自動確認（cp-watch）の保存先と「次に確認する案件を選ぶ」仕組み | |
| 不明 | `docs/sql/customer-cases.sql` | お客様の「顧客カルテ」（案件ごとのイレギュラー・解決策・改善案をチームで共有） | |
| 不明 | `docs/sql/customer-rules.sql` | お客様・担当者ごとの「取引ルール」（チーム共有） | |
| 不明 | `docs/sql/drift-log.sql` | 🔍 ゆらぎチェックの記録（チーム共有） | |
| 不明 | `docs/sql/feedback-ai-export.sql` | 【任意】AI（Claude）が不具合報告を直接読めるようにする読み取り専用 API | |
| 不明 | `docs/sql/feedback-comments.sql` | 不具合報告：やりとり（管理者→報告者への質問／報告者の返信／コメント）と「確認待ち」状態 | |
| 不明 | `docs/sql/feedback-reports.sql` | 不具合報告（フィードバック拡張）：添付（スクショ・動画）／対応状況／画面情報 | |
| 不明 | `docs/sql/feedback-votes.sql` | 💡 アイデア：「いいね（👍）」投票 | |
| 不明 | `docs/sql/master-approval.sql` | マスターの承認制（申請 → 管理者が承認） | |
| 不明 | `docs/sql/master-news.sql` | サブコン・お客様の「ニュース」（新着ニュース・事務所移転・担当変更などを時系列で記録／チーム共有） | |
| 不明 | `docs/sql/master-request-country.sql` | 港の登録申請に「国」を持たせる（見積の POL／経由地／POD で国を選んで未登録の港を申請したとき、承認と一緒に国を付 | |
| 不明 | `docs/sql/quote-preset-editors.sql` | quote_presets：更新者の履歴（editors）をトリガーで自動記録 | |
| 不明 | `docs/sql/quote-preset-links.sql` | quote_preset_links: 見積案件同士の関連付け（分割・代替提案・過去履歴の参照など） | |
| 不明 | `docs/sql/quote-preset-ref.sql` | quote_presets：見積もり番号（管理番号／仮REF#）を検索可能な独立列に昇格 | |
| 不明 | `docs/sql/quote-preset-tags.sql` | quote_presets: 案件タグ（分類・絞り込み・並び替え用） | |
| 不明 | `docs/sql/remark-presets-cargo-verify.sql` | remark_presets: 貨物種別リマーク＋確認（検証）記録 | |
| 不明 | `docs/sql/stats-exclusions.sql` | 統計の「除外リスト」（表記ゆれのまとめから外す名前）をチームで共有する | |
| 不明 | `docs/sql/synonym-groups-approval.sql` | 別名（synonym_groups）を、マスターの承認制に合わせる | |
| 不明 | `docs/sql/translation-dict.sql` | 英訳辞書（御見積書の英語出力で、日本語の品名・リマークを英語にするための対応表／チーム共有） | |
| 不明 | `docs/sql/work-folders-storage.sql` | 📁 作業フォルダ：Supabase の保存領域（Storage）版 | |
| 不明 | `docs/sql/work-folders.sql` | 📁 作業フォルダ（ユーザーごとの個人フォルダ）…共通の土台 | |
| 不明 | `docs/supabase-alias-rules-setup.sql` | エイリアスルールテーブル（ゆらぎ是正） | |
| 不明 | `docs/supabase-attachments-setup.sql` | quote_attachments テーブル + Storage バケット セットアップ | |
| 不明 | `docs/supabase-charge-notices.sql` | 料金改定案内: 案内履歴テーブル（チーム共有・送信状況管理） | |
| 不明 | `docs/supabase-chat-setup.sql` | quote_comments テーブル セットアップ | |
| 不明 | `docs/supabase-local-charges-migration.sql` | ローカルチャージ: 既存テーブルへの列追加マイグレーション | |
| 不明 | `docs/supabase-local-charges-setup.sql` | ローカルチャージタブ: チャージマスターテーブル | |
| 不明 | `docs/supabase-local-charges-storage.sql` | ローカルチャージ: 添付ファイルの Supabase Storage 共有セットアップ | |
| 不明 | `docs/supabase-local-charges-taxable.sql` | ローカルチャージ: 消費税区分（課税/免税）列の追加 | |
| 不明 | `docs/supabase-master-attachments-setup.sql` | マスター管理: 添付ファイル（お客様マスター等・保管期限なし） | |
| 不明 | `docs/supabase-master-details-setup.sql` | マスター管理タブ: マスター詳細情報テーブル（種別ごとの追加情報・チーム共有） | |
| 不明 | `docs/supabase-master-votes-setup.sql` | 統計タブ: マスター候補投票テーブル | |
| 不明 | `docs/supabase-remark-presets-setup.sql` | 全体リマーク・免責事項タブ：チーム共有プリセット（remark_presets） | |
| 不明 | `docs/supabase-row-patterns-direction-tags.sql` | 明細プリセット（row_patterns）: 大分類（輸出/輸入）とタグの追加 | |
| 不明 | `docs/supabase-schema.sql` | フォワーダー支援 — Supabase スキーマ定義 | |
| 不明 | `docs/supabase-synonym-groups-setup.sql` | 統計タブ: 同義グループテーブル（⭐代表 → 統合・非破壊・チーム共有） | |
