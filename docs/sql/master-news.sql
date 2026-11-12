-- サブコン・お客様の「ニュース」（新着ニュース・事務所移転・担当変更などを時系列で記録／チーム共有）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
-- 前提: is_team_member()（チームメンバー判定）が作成済みであること
--
-- 1 件＝1 ニュース。field は sv（サブコン）／customer（お客様）、name はマスターの代表名。
-- kind：news（新着ニュース）／move（事務所移転）／contact（担当変更）／org（社名・組織の変更）／terms（取引条件の変更）／other
-- news_date：出来事の日（並び順はこの日の新しい順）。url：参考リンク（任意）

create table if not exists public.master_news (
  id          uuid        primary key default gen_random_uuid(),
  field       text        not null check (field in ('sv', 'customer')),
  name        text        not null,
  kind        text        not null default 'news' check (kind in ('news', 'move', 'contact', 'org', 'terms', 'other')),
  news_date   date        not null default current_date,
  title       text        not null,
  body        text,
  url         text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_master_news_name on public.master_news (field, name, news_date desc);

alter table public.master_news enable row level security;
grant select, insert, update, delete on public.master_news to authenticated;

drop policy if exists "team members can read master_news" on public.master_news;
create policy "team members can read master_news" on public.master_news
  for select using (is_team_member());

drop policy if exists "team members can insert master_news" on public.master_news;
create policy "team members can insert master_news" on public.master_news
  for insert with check (is_team_member() and created_by = (auth.jwt() ->> 'email'));

drop policy if exists "team members can update master_news" on public.master_news;
create policy "team members can update master_news" on public.master_news
  for update using (is_team_member()) with check (is_team_member());

drop policy if exists "team members can delete master_news" on public.master_news;
create policy "team members can delete master_news" on public.master_news
  for delete using (is_team_member());
