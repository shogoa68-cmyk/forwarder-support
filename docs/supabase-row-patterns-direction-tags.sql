-- 明細プリセット（row_patterns）: 大分類（輸出/輸入）とタグの追加
-- 目的: 諸チャージタブの「明細プリセット」で、案件同様に輸出/輸入の大分類設定と
--       自由なタグ付けによる柔軟な分類・絞り込みができるようにする
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等・再実行安全）

ALTER TABLE row_patterns ADD COLUMN IF NOT EXISTS direction text;             -- 'export' | 'import' | NULL(共通)
ALTER TABLE row_patterns ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]'::jsonb;  -- 自由なタグ（文字列配列）

NOTIFY pgrst, 'reload schema';
