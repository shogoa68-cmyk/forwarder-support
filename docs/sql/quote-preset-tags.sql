-- =====================================================================
-- quote_presets: 案件タグ（分類・絞り込み・並び替え用）
-- =====================================================================
-- 目的：
--   案件ごとに自由なタグ（複数可）を付けられるようにする。ダッシュボード
--   のタグ絞り込みチップ・並び替え（タグ順）・案件編集画面のタグ入力、
--   いずれもこの tags 列を直接参照する。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等）。
--
-- 前提：
--   ・既存テーブル public.quote_presets が存在すること
-- =====================================================================

alter table public.quote_presets
  add column if not exists tags text[] not null default '{}';

comment on column public.quote_presets.tags is
  '案件タグ（複数可・自由入力）。ダッシュボードの絞り込みチップ・並び替えで使用';

-- タグでの絞り込み（array-contains）を高速化
create index if not exists idx_quote_presets_tags on public.quote_presets using gin (tags);
