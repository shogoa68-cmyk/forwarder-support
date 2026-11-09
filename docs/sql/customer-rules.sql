-- お客様・担当者ごとの「取引ルール」（チーム共有）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
-- 前提: is_team_member()（チームメンバー判定）が作成済みであること
--
-- 1 件＝1 ルール。contact が空ならお客様全体、値があればその担当者のルール。
-- level：memo（メモ）／check（要確認）／strict（厳守）。status：active／retired（廃止。履歴として残す）
-- confirmed_at：「いまも有効」と最後に確認した日（半年以上たつと画面で再確認を促す）

create table if not exists public.customer_rules (
  id            uuid        primary key default gen_random_uuid(),
  customer      text        not null,                              -- お客様名（マスターの代表名）
  contact       text,                                              -- 担当者名（敬称略）。空＝お客様全体
  level         text        not null default 'memo' check (level in ('memo', 'check', 'strict')),
  body          text        not null,                              -- ルールの内容
  reason        text,                                              -- 背景（任意）
  status        text        not null default 'active' check (status in ('active', 'retired')),
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_by    text,
  updated_at    timestamptz not null default now(),
  confirmed_by  text,
  confirmed_at  timestamptz not null default now()
);
create index if not exists idx_customer_rules_customer on public.customer_rules (customer);

alter table public.customer_rules enable row level security;
grant select, insert, update, delete on public.customer_rules to authenticated;

drop policy if exists "team members can read customer_rules" on public.customer_rules;
create policy "team members can read customer_rules" on public.customer_rules
  for select using (is_team_member());

drop policy if exists "team members can insert customer_rules" on public.customer_rules;
create policy "team members can insert customer_rules" on public.customer_rules
  for insert with check (is_team_member() and created_by = (auth.jwt() ->> 'email'));

drop policy if exists "team members can update customer_rules" on public.customer_rules;
create policy "team members can update customer_rules" on public.customer_rules
  for update using (is_team_member()) with check (is_team_member());

drop policy if exists "team members can delete customer_rules" on public.customer_rules;
create policy "team members can delete customer_rules" on public.customer_rules
  for delete using (is_team_member());
