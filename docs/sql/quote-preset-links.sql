-- =====================================================================
-- quote_preset_links: 見積案件同士の関連付け（分割・代替提案・過去履歴の参照など）
-- =====================================================================
-- 目的：
--   1つの引き合いを複数の見積プリセットに分けて作成した場合（多レグ・
--   FCL/LCL の代替提案など）や、類似見積パネルで見つけた取引先の過去
--   案件を参考として残しておきたい場合に、コピー（copiedFrom）ではない
--   任意の2案件を手動でつなげる。carrier_relations（会社間の関係性）と
--   同じ考え方で、preset_a/preset_b のどちらの側から見ても相手が見つかる
--   （常に双方向）。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等）。
--
-- 前提：
--   ・既存テーブル public.quote_presets が存在すること
--   ・チーム判定関数 public.is_team_member() が存在すること
-- =====================================================================

create table if not exists public.quote_preset_links (
  id         uuid primary key default gen_random_uuid(),
  preset_a   uuid not null references public.quote_presets(id) on delete cascade,
  preset_b   uuid not null references public.quote_presets(id) on delete cascade,
  note       text,                          -- 任意メモ（例：「同一案件のLCL分)」「代替プラン」）
  created_by text,
  created_at timestamptz not null default now(),
  check (preset_a <> preset_b)
);

create index if not exists idx_quote_preset_links_a on public.quote_preset_links (preset_a);
create index if not exists idx_quote_preset_links_b on public.quote_preset_links (preset_b);

grant select, insert, update, delete on public.quote_preset_links to authenticated;

alter table public.quote_preset_links enable row level security;

drop policy if exists "team read quote preset links" on public.quote_preset_links;
create policy "team read quote preset links" on public.quote_preset_links
  for select using (public.is_team_member());

drop policy if exists "team write quote preset links" on public.quote_preset_links;
create policy "team write quote preset links" on public.quote_preset_links
  for all using (public.is_team_member()) with check (public.is_team_member());
