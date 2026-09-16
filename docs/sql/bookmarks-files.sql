-- =====================================================================
-- bookmarks: ファイル添付（Storage）対応
-- =====================================================================
-- 目的：
--   これまで URL のみだったブックマークに、ファイル（料金表PDF・案内資料
--   など）を直接アップロードしてチーム共有できるようにする。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等）。
--   ※ Storage バケットの INSERT が SQL Editor で制限される場合は、
--     ダッシュボードの Storage → New bucket から手動作成してもよい
--     （Name = bookmark-files, Public = OFF）。
--
-- 前提：
--   ・public.bookmarks が存在すること（本体の bookmarks-*.sql 実行済み）
--   ・チーム判定関数 public.is_team_member() が存在すること
-- =====================================================================

-- 1) bookmarks にファイル列を追加 ---------------------------------------
alter table public.bookmarks
  add column if not exists file_path text,   -- Storage 上のパス: {bookmark_id}/{ts}_{filename}
  add column if not exists file_name text,   -- 元のファイル名（表示用・日本語可）
  add column if not exists file_size integer,
  add column if not exists mime_type text;

-- 2) Storage バケット作成 -------------------------------------------------
insert into storage.buckets (id, name, public)
values ('bookmark-files', 'bookmark-files', false)
on conflict do nothing;

-- 3) Storage オブジェクトの RLS ポリシー ----------------------------------
drop policy if exists "team upload bookmark files" on storage.objects;
create policy "team upload bookmark files"
  on storage.objects for insert
  with check (bucket_id = 'bookmark-files' and public.is_team_member());

drop policy if exists "team read bookmark files" on storage.objects;
create policy "team read bookmark files"
  on storage.objects for select
  using (bucket_id = 'bookmark-files' and public.is_team_member());

drop policy if exists "team delete bookmark files" on storage.objects;
create policy "team delete bookmark files"
  on storage.objects for delete
  using (bucket_id = 'bookmark-files' and public.is_team_member());
