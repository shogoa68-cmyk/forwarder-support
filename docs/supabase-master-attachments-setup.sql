-- マスター管理: 添付ファイル（お客様マスター等・保管期限なし）
-- 対象フィールド: master_details と同じ 'customer' / 'nm' / 'sv' / 'carrier' / 'port'
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run
--   ※ ファイル全体を何度実行しても安全（冪等）。
--
-- ※ quote_attachments（案件への添付）とは別テーブル・別 Storage バケット。
--    quote_attachments は 14日で自動削除する pg_cron ジョブ
--    (purge_expired_attachments) がバケット単位で対象にしているため、
--    「保管期限を定めない」という要件を満たすには同じバケットを使い回さず、
--    専用バケット（master-attachments）を用意する必要がある。
--    このファイルには自動削除の仕組みは一切含めない。
--
-- ※ このテーブル／バケットが未作成でも、アプリ側は「ログインが必要です」
--    「添付機能は未設定です」等の案内を出すだけで、他の機能には影響しない。

-- Storage バケット（非公開・署名URLで閲覧）
insert into storage.buckets (id, name, public)
  values ('master-attachments', 'master-attachments', false)
  on conflict (id) do nothing;

-- メタテーブル
create table if not exists public.master_attachments (
  id           uuid        primary key default gen_random_uuid(),
  field        text        not null check (field in ('customer', 'nm', 'sv', 'carrier', 'port')),
  value        text        not null,           -- マスター値（お客様名称 等。master_details.value と対応）
  storage_path text        not null,           -- storage オブジェクトのパス
  file_name    text        not null,           -- 元ファイル名
  file_size    bigint,
  mime_type    text,
  uploaded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_master_attachments_field_value on public.master_attachments(field, value);

alter table public.master_attachments enable row level security;
grant select, insert, delete on public.master_attachments to authenticated;

drop policy if exists "ma select" on public.master_attachments;
create policy "ma select" on public.master_attachments for select to authenticated using (is_team_member());
drop policy if exists "ma insert" on public.master_attachments;
create policy "ma insert" on public.master_attachments for insert to authenticated with check (is_team_member() and uploaded_by = auth.email());
drop policy if exists "ma delete" on public.master_attachments;
create policy "ma delete" on public.master_attachments for delete to authenticated using (is_team_member());

-- Storage オブジェクトの RLS（master-attachments バケットはチームメンバーのみ）
drop policy if exists "ma obj select" on storage.objects;
create policy "ma obj select" on storage.objects for select to authenticated
  using (bucket_id = 'master-attachments' and is_team_member());
drop policy if exists "ma obj insert" on storage.objects;
create policy "ma obj insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'master-attachments' and is_team_member());
drop policy if exists "ma obj delete" on storage.objects;
create policy "ma obj delete" on storage.objects for delete to authenticated
  using (bucket_id = 'master-attachments' and is_team_member());

-- 保管期限なし：quote_attachments のような pg_cron 自動削除ジョブは意図的に設定しない。
-- 削除はユーザーが「✕」ボタンで明示的に行った場合のみ。
