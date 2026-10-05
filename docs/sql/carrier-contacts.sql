-- =====================================================================
-- carrier_contacts: 船会社／LCLキャリアの連絡先（担当者を複数登録可）
-- =====================================================================
-- 目的：
--   各キャリア（会社名）の連絡先（担当名・部署名・電話番号・メール・メモ）を
--   チームで共有する。1社に複数の担当者を登録できる（1担当者＝1行）。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run。
--   ※ 新規作成でも、旧版（1社1件）実行済みの環境でも、そのまま再実行できる
--     （冪等）。旧版で登録済みの連絡先は「1人目の担当者」としてそのまま残る。
--
-- 前提：
--   ・チーム判定関数 public.is_team_member() が存在すること
--     （※ SQL Editor で作成したテーブルは authenticated への GRANT が
--       自動付与されないため、本ファイルは明示的に GRANT する）
-- =====================================================================

create table if not exists public.carrier_contacts (
  id          uuid primary key default gen_random_uuid(),
  carrier     text not null,
  person_name text,                 -- 担当名
  department  text,                 -- 部署名
  phone       text,
  email       text,
  note        text,
  sort_order  integer not null default 0,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- 旧版（carrier が unique ＝1社1件）からの移行：一意制約を外し、新列を追加
alter table public.carrier_contacts drop constraint if exists carrier_contacts_carrier_key;
alter table public.carrier_contacts add column if not exists person_name text;
alter table public.carrier_contacts add column if not exists department  text;
alter table public.carrier_contacts add column if not exists sort_order  integer not null default 0;

create index if not exists idx_carrier_contacts_carrier on public.carrier_contacts (carrier);

grant select, insert, update, delete on public.carrier_contacts to authenticated;

alter table public.carrier_contacts enable row level security;

drop policy if exists "team read carrier contacts" on public.carrier_contacts;
create policy "team read carrier contacts" on public.carrier_contacts
  for select using (public.is_team_member());

drop policy if exists "team write carrier contacts" on public.carrier_contacts;
create policy "team write carrier contacts" on public.carrier_contacts
  for all using (public.is_team_member()) with check (public.is_team_member());
