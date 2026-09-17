-- ============================================================================
-- drive-broker（外部ストレージ PoC）用テーブル
-- ----------------------------------------------------------------------------
-- ポータルフォルダの folderId など、アプリのちょっとした設定値を保持する
-- 汎用 key-value テーブル。Edge Function（service_role）が読み書きする。
--
-- Supabase ダッシュボード → SQL Editor で実行すること。
-- ============================================================================

create table if not exists public.app_config (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

-- 読み取りはチームメンバーのみ（service_role は RLS をバイパスするので Edge Function は無条件で読み書き可）。
drop policy if exists app_config_select on public.app_config;
create policy app_config_select on public.app_config
  for select
  using (public.is_team_member());

-- 書き込みは Edge Function（service_role）のみに任せ、一般ユーザーには付与しない。
-- （INSERT/UPDATE/DELETE ポリシーを作らない = 一般ユーザーは書き込み不可）

comment on table public.app_config is 'アプリ設定の key-value（例: portal_folder_id = Google Drive ポータルフォルダID）';
