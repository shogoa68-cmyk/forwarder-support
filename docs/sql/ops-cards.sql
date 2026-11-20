-- 📦 進行管理：作業カード（手順メモ・やりとり）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
-- 前提: is_team_member()（チームメンバー判定）が作成済みであること
--
-- ① ops_guides：作業ごとの「手順メモ」。作業の名前（【往路】【復路】を除き、空白・大文字小文字をそろえたもの）を key にして、
--    同じ名前の作業なら、どの案件・どの進行でも同じメモが出る（チームで共有・誰でも直せる・最後に直した人と日時が残る）
-- ② ops_notes：作業ごとの「やりとり・記録」。追記だけ（直さない）。消せるのは書いた本人だけ
--    target：'q:<見積の案件 id>'／'j:<進行 id>'／'j:<進行 id>:<便 id>'、step_id：チェックリストの作業の id
--    案件・進行を消しても記録は残る（画面には出ない）
-- 画面は js/quote/ops-progress.js（📦 進行管理タブ・チェックリストの作業カード）。この SQL を実行するまでは、
-- 状態（作業中・返事待ち）・担当・締め切りは使えるが、手順メモとやりとりの欄は「サーバー側の準備がまだ」と出る

create extension if not exists pgcrypto;

-- ---------- ① 手順メモ ----------
create table if not exists public.ops_guides (
  key         text        primary key check (length(btrim(key)) > 0 and length(key) <= 120),
  label       text        check (label is null or length(label) <= 120),
  body        text        not null default '' check (length(body) <= 4000),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create or replace function public.ops_guides_touch() returns trigger language plpgsql as $$
begin
  new.updated_by := coalesce(auth.jwt() ->> 'email', new.updated_by);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_ops_guides_touch on public.ops_guides;
create trigger trg_ops_guides_touch before insert or update on public.ops_guides
  for each row execute function public.ops_guides_touch();

alter table public.ops_guides enable row level security;
revoke all on public.ops_guides from anon;
grant select, insert, update, delete on public.ops_guides to authenticated;

drop policy if exists "team members can read ops_guides" on public.ops_guides;
create policy "team members can read ops_guides" on public.ops_guides for select using (is_team_member());
drop policy if exists "team members can insert ops_guides" on public.ops_guides;
create policy "team members can insert ops_guides" on public.ops_guides for insert with check (is_team_member());
drop policy if exists "team members can update ops_guides" on public.ops_guides;
create policy "team members can update ops_guides" on public.ops_guides for update using (is_team_member()) with check (is_team_member());
drop policy if exists "team members can delete ops_guides" on public.ops_guides;
create policy "team members can delete ops_guides" on public.ops_guides for delete using (is_team_member());

-- ---------- ② やりとり・記録 ----------
create table if not exists public.ops_notes (
  id          uuid        primary key default gen_random_uuid(),
  target      text        not null check (length(target) between 3 and 200),
  step_id     text        not null check (length(step_id) between 1 and 60),
  body        text        not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ops_notes_target on public.ops_notes (target, created_at);

-- 書いた人と日時はサーバーが決める（他人の名前では書けない）
create or replace function public.ops_notes_touch() returns trigger language plpgsql as $$
begin
  new.created_by := auth.jwt() ->> 'email';
  new.created_at := now();
  return new;
end $$;
drop trigger if exists trg_ops_notes_touch on public.ops_notes;
create trigger trg_ops_notes_touch before insert on public.ops_notes
  for each row execute function public.ops_notes_touch();

alter table public.ops_notes enable row level security;
revoke all on public.ops_notes from anon;
revoke update on public.ops_notes from authenticated;   -- 記録は直さない（追記だけ）
grant select, insert, delete on public.ops_notes to authenticated;

drop policy if exists "team members can read ops_notes" on public.ops_notes;
create policy "team members can read ops_notes" on public.ops_notes for select using (is_team_member());
drop policy if exists "team members can insert ops_notes" on public.ops_notes;
create policy "team members can insert ops_notes" on public.ops_notes for insert with check (is_team_member());
drop policy if exists "authors can delete ops_notes" on public.ops_notes;
create policy "authors can delete ops_notes" on public.ops_notes for delete
  using (is_team_member() and created_by = (auth.jwt() ->> 'email'));
