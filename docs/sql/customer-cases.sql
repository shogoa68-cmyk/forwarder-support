-- お客様の「顧客カルテ」（案件ごとのイレギュラー・解決策・改善案をチームで共有）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
-- 前提: is_team_member()（チームメンバー判定）が作成済みであること
--
-- 1 件＝1 事例。situation＝何が起きたか／action＝どう解決したか／improvement＝次回どうすれば良いか
-- status：open（未解決）／resolved（解決済み）。ref：案件の管理番号（任意）。subcon／contact：関係したサブコン・先方の担当者（任意）
-- promoted_at：「取引ルール」に昇格した日時（昇格済みの目印）

create table if not exists public.customer_cases (
  id           uuid        primary key default gen_random_uuid(),
  customer     text        not null,                              -- お客様名（マスターの代表名）
  ref          text,                                              -- 案件の管理番号
  occurred_on  date        not null default current_date,
  kind         text        not null default 'other' check (kind in ('delay', 'doc', 'cost', 'cargo', 'comm', 'other')),
  title        text        not null,
  situation    text,
  action       text,
  improvement  text,
  subcon       text,
  contact      text,
  status       text        not null default 'open' check (status in ('open', 'resolved')),
  promoted_at  timestamptz,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now()
);
create index if not exists idx_customer_cases_customer on public.customer_cases (customer, occurred_on desc);

alter table public.customer_cases enable row level security;
grant select, insert, update, delete on public.customer_cases to authenticated;

drop policy if exists "team members can read customer_cases" on public.customer_cases;
create policy "team members can read customer_cases" on public.customer_cases
  for select using (is_team_member());

drop policy if exists "team members can insert customer_cases" on public.customer_cases;
create policy "team members can insert customer_cases" on public.customer_cases
  for insert with check (is_team_member() and created_by = (auth.jwt() ->> 'email'));

drop policy if exists "team members can update customer_cases" on public.customer_cases;
create policy "team members can update customer_cases" on public.customer_cases
  for update using (is_team_member()) with check (is_team_member());

drop policy if exists "team members can delete customer_cases" on public.customer_cases;
create policy "team members can delete customer_cases" on public.customer_cases
  for delete using (is_team_member());
