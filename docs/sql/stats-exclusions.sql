-- 統計の「除外リスト」（表記ゆれのまとめから外す名前）をチームで共有する
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
--
-- 前提: is_team_member()（チームメンバー判定）が作成済みであること
-- このファイルを実行するまでは、アプリは従来どおり、このブラウザにだけ除外リストを保存する

create table if not exists public.stats_exclusions (
  id          uuid        primary key default gen_random_uuid(),
  field       text        not null,                 -- 'sv' | 'carrier' | 'nm' | 'un' | 'customer' | 'port'
  value       text        not null,                 -- まとめから外す名前
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (field, value)
);

alter table public.stats_exclusions enable row level security;

-- テーブル権限（RLS とは別。これが無いと "permission denied for table stats_exclusions" になり、
-- アプリは共有テーブルを使えないと判断して、このブラウザだけの除外リストのままになる）
grant select, insert, delete on public.stats_exclusions to authenticated;

drop policy if exists "team members can read stats exclusions" on public.stats_exclusions;
create policy "team members can read stats exclusions" on public.stats_exclusions
  for select using (is_team_member());

drop policy if exists "team members can add stats exclusions" on public.stats_exclusions;
create policy "team members can add stats exclusions" on public.stats_exclusions
  for insert with check (is_team_member() and created_by = (auth.jwt() ->> 'email'));

drop policy if exists "team members can remove stats exclusions" on public.stats_exclusions;
create policy "team members can remove stats exclusions" on public.stats_exclusions
  for delete using (is_team_member());
