-- =====================================================================
-- carrier_contacts: 船会社／LCLキャリアの連絡先（電話・メール）共有
-- =====================================================================
-- 目的：
--   各キャリア（会社名）の連絡先（電話番号・メールアドレス・備考）を
--   チームで共有する。ブックマーク（個々のリンク）とは別に、会社単位で
--   1件だけ持つ情報として管理する。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等）。
--
-- 前提：
--   ・チーム判定関数 public.is_team_member() が存在すること
--     （※ SQL Editor で作成した関数・テーブルは authenticated への GRANT が
--       自動付与されないため、本ファイルは明示的に GRANT する）
-- =====================================================================

create table if not exists public.carrier_contacts (
  id         uuid primary key default gen_random_uuid(),
  carrier    text not null unique,
  phone      text,
  email      text,
  note       text,
  updated_by text,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.carrier_contacts to authenticated;

alter table public.carrier_contacts enable row level security;

drop policy if exists "team read carrier contacts" on public.carrier_contacts;
create policy "team read carrier contacts" on public.carrier_contacts
  for select using (public.is_team_member());

drop policy if exists "team write carrier contacts" on public.carrier_contacts;
create policy "team write carrier contacts" on public.carrier_contacts
  for all using (public.is_team_member()) with check (public.is_team_member());
