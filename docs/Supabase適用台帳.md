# Supabase 適用台帳（SQL を Supabase に渡したか／まだか）

> ⚙️ **この表は `node scripts/sql-ledger.js` が自動で作ります。手で直さないでください**（印は `docs/sql-ledger.json` に入ります）。

全ブランチ（別セッションで作った分も）と作業ツリーの `docs/sql/*.sql`・`docs/supabase-*.sql` を自動で集めて、「渡した／まだ」を表にしています。

| 状態 | 件数 | 意味 |
|---|---|---|
| 🔴 未渡し | 3 | 新しい SQL。まだ Supabase で実行していない（main にも入っていない分を含む） |
| 🟠 変更あり | 0 | 渡し済みの SQL を、そのあと書き換えた。再実行が必要か確認する |
| ⚪ 不明 | 49 | 過去に作った SQL で、実行したか記録がない（確認待ち） |
| 🟢 渡し済み | 0 | 実行済み（日付つき） |

## 使い方

1. SQL を新しく作る → 台帳には何もしなくてよい（`node scripts/sql-ledger.js` で自動的に「未渡し」に出る）。
2. 渡していない SQL をまとめて出す：`node scripts/sql-ledger.js --pending`（Supabase の SQL Editor に貼る）。
3. 実行したら：`node scripts/sql-ledger.js --mark <ファイル名>`（例：`--mark master-news.sql`）。Claude に「○○ を渡した」と伝えても同じ。
4. 過去分で実行済みのものは `--mark-unknown`（不明をまとめて渡し済みに）か、1 本ずつ `--mark`。
5. 台帳（このファイル）は `node scripts/sql-ledger.js` で作り直す。**別セッションの分を見るには先に `--fetch`**（全ブランチの最新を取り込む）。

※ まだ push していないブランチの SQL は、その作業ツリーでしか見えません。別セッションの SQL は、そのセッションが push した時点で拾えます。
※ 台帳ファイルを別ブランチと同時に編集して競合したら、どちらかを採用してから `node scripts/sql-ledger.js` を実行すれば作り直せます（印は json 側。json が競合したら両方の行を残す）。

## 🔴 未渡し（3）

| ファイル | 何のための SQL か | どこにある | メモ |
|---|---|---|---|
| `docs/sql/master-history.sql` | マスターの変更履歴（追記のみ・書き換え不可）【案・まだ Supabase では実行していない】 | claude/wonderful-wright-e7b23p |  |
| `docs/sql/org-teams.sql` | 🏢 組織とチーム（名簿の整理・ダッシュボードの「全体／組織／チーム／自分」の絞り込み用） | claude/kind-bohr-9c4b0x |  |
| `docs/sql/trash-quote-presets.sql` | 削除の「ゴミ箱」化・段階 1（案件 quote_presets ＋ 連鎖で消える quote_preset_links） | claude/security-policy-ledger |  |

## 🟠 変更あり（渡したあとに書き換えた）（0）

（なし）

## ⚪ 不明（過去分・実行したか記録なし）（49）

| ファイル | 何のための SQL か | どこにある | メモ |
|---|---|---|---|
| `docs/sql/admin-edit-creator.sql` | 【一時措置】管理者が見積（案件）の「作成者」を変更する | main |  |
| `docs/sql/alias-rules-add-customer.sql` | エイリアス是正の対象に「お客様(customer)」を追加するためのマイグレーション。 | main |  |
| `docs/sql/announcements.sql` | 📢 管理者からメンバーへの「お知らせ」 | main |  |
| `docs/sql/bookmark-clicks.sql` | bookmark_clicks: ブックマーク（チップ）のクリック数の記録・集計 | main |  |
| `docs/sql/bookmarks-files.sql` | bookmarks: ファイル添付（Storage）対応 | main |  |
| `docs/sql/bookmarks-migration.sql` | bookmarks 全面クラウド移行 ＋ 編集履歴（トリガー自動記録）  フェーズ1 | main |  |
| `docs/sql/bookmarks-update-policy.sql` | bookmarks: UPDATE 用 RLS ポリシーの追加（編集が保存されない不具合の修正） | main |  |
| `docs/sql/bookmarks-verifications.sql` | bookmarks: リンク確認（人による「確認済み」記録）テーブル | main |  |
| `docs/sql/calendar-migration.sql` | カレンダータブ：祝日・サーチャージ適用日 テーブル ＋ 編集履歴 | main |  |
| `docs/sql/carrier-contacts.sql` | carrier_contacts: 船会社／LCLキャリアの連絡先（担当者を複数登録可） | main |  |
| `docs/sql/carrier-relations.sql` | carrier_relations: 会社間の関係性登録（代理店関係など・統合ではない） | main |  |
| `docs/sql/carrier-sv-migration-count.sql` | キャリア → サブコン 統合（段階 2）の前に、影響範囲を数える（読み取りだけ。何も変更しない） | main |  |
| `docs/sql/cp-events.sql` | サイバーポート Webhook：受け取った通知の保存先 cp_events | main |  |
| `docs/sql/cp-watch.sql` | 🚢 サイバーポート：動静の自動確認（cp-watch）の保存先と「次に確認する案件を選ぶ」仕組み | main, claude/serene-clarke-coab3r |  |
| `docs/sql/customer-cases.sql` | お客様の「顧客カルテ」（案件ごとのイレギュラー・解決策・改善案をチームで共有） | main |  |
| `docs/sql/customer-rules.sql` | お客様・担当者ごとの「取引ルール」（チーム共有） | main |  |
| `docs/sql/drift-log.sql` | 🔍 ゆらぎチェックの記録（チーム共有） | main |  |
| `docs/sql/feedback-ai-export.sql` | 【任意】AI（Claude）が不具合報告を直接読めるようにする読み取り専用 API | main |  |
| `docs/sql/feedback-comments.sql` | 不具合報告：やりとり（管理者→報告者への質問／報告者の返信／コメント）と「確認待ち」状態 | main |  |
| `docs/sql/feedback-reports.sql` | 不具合報告（フィードバック拡張）：添付（スクショ・動画）／対応状況／画面情報 | main |  |
| `docs/sql/feedback-votes.sql` | 💡 アイデア：「いいね（👍）」投票 | main |  |
| `docs/sql/master-approval.sql` | マスターの承認制（申請 → 管理者が承認） | main |  |
| `docs/sql/master-news.sql` | サブコン・お客様の「ニュース」（新着ニュース・事務所移転・担当変更などを時系列で記録／チーム共有） | main |  |
| `docs/sql/master-request-country.sql` | 港の登録申請に「国」を持たせる（見積の POL／経由地／POD で国を選んで未登録の港を申請したとき、承認と一緒に国を付ける） | main |  |
| `docs/sql/quote-preset-editors.sql` | quote_presets：更新者の履歴（editors）をトリガーで自動記録 | main |  |
| `docs/sql/quote-preset-links.sql` | quote_preset_links: 見積案件同士の関連付け（分割・代替提案・過去履歴の参照など） | main |  |
| `docs/sql/quote-preset-ref.sql` | quote_presets：見積もり番号（管理番号／仮REF#）を検索可能な独立列に昇格 | main |  |
| `docs/sql/quote-preset-tags.sql` | quote_presets: 案件タグ（分類・絞り込み・並び替え用） | main |  |
| `docs/sql/remark-presets-cargo-verify.sql` | remark_presets: 貨物種別リマーク＋確認（検証）記録 | main |  |
| `docs/sql/stats-exclusions.sql` | 統計の「除外リスト」（表記ゆれのまとめから外す名前）をチームで共有する | main |  |
| `docs/sql/synonym-groups-approval.sql` | 別名（synonym_groups）を、マスターの承認制に合わせる | main |  |
| `docs/sql/translation-dict.sql` | 英訳辞書（御見積書の英語出力で、日本語の品名・リマークを英語にするための対応表／チーム共有） | main |  |
| `docs/sql/work-folders-storage.sql` | 📁 作業フォルダ：Supabase の保存領域（Storage）版 | main |  |
| `docs/sql/work-folders.sql` | 📁 作業フォルダ（ユーザーごとの個人フォルダ）…共通の土台 | main |  |
| `docs/supabase-alias-rules-setup.sql` | エイリアスルールテーブル（ゆらぎ是正） | main |  |
| `docs/supabase-attachments-setup.sql` | quote_attachments テーブル + Storage バケット セットアップ | main |  |
| `docs/supabase-charge-notices.sql` | 料金改定案内: 案内履歴テーブル（チーム共有・送信状況管理） | main |  |
| `docs/supabase-chat-setup.sql` | quote_comments テーブル セットアップ | main |  |
| `docs/supabase-local-charges-migration.sql` | ローカルチャージ: 既存テーブルへの列追加マイグレーション | main |  |
| `docs/supabase-local-charges-setup.sql` | ローカルチャージタブ: チャージマスターテーブル | main |  |
| `docs/supabase-local-charges-storage.sql` | ローカルチャージ: 添付ファイルの Supabase Storage 共有セットアップ | main |  |
| `docs/supabase-local-charges-taxable.sql` | ローカルチャージ: 消費税区分（課税/免税）列の追加 | main |  |
| `docs/supabase-master-attachments-setup.sql` | マスター管理: 添付ファイル（お客様マスター等・保管期限なし） | main |  |
| `docs/supabase-master-details-setup.sql` | マスター管理タブ: マスター詳細情報テーブル（種別ごとの追加情報・チーム共有） | main |  |
| `docs/supabase-master-votes-setup.sql` | 統計タブ: マスター候補投票テーブル | main |  |
| `docs/supabase-remark-presets-setup.sql` | 全体リマーク・免責事項タブ：チーム共有プリセット（remark_presets） | main |  |
| `docs/supabase-row-patterns-direction-tags.sql` | 明細プリセット（row_patterns）: 大分類（輸出/輸入）とタグの追加 | main |  |
| `docs/supabase-schema.sql` | フォワーダー支援 — Supabase スキーマ定義 | main |  |
| `docs/supabase-synonym-groups-setup.sql` | 統計タブ: 同義グループテーブル（⭐代表 → 統合・非破壊・チーム共有） | main |  |

## 🟢 渡し済み（0）

（なし）

