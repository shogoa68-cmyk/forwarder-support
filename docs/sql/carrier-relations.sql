-- =====================================================================
-- carrier_relations: 会社間の関係性登録（代理店関係など・統合ではない）
-- =====================================================================
-- 目的：
--   「ダイトーコーポレーション」と「SITC」のように、同一会社の表記ゆらぎ
--   ではなく、別会社だが業務上つながりがある関係（代理店関係など）を
--   登録する。統計タブの同義語機能（synonym_groups＝統合・1つに集約）
--   とは異なり、両方の名前・両方のブックマークをそのまま残しつつ、
--   関係だけを結びつける。
--
--   登録すると：
--   ・BOOKMARK タブの両キャリアタイルに「[ラベル: 相手名]」チップを表示
--   ・見積タブの幹線輸送で片方のキャリアを選ぶと、もう片方に登録された
--     ブックマークも QSP チップに一緒に表示される
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等）。
--
-- 前提：
--   ・チーム判定関数 public.is_team_member() が存在すること
-- =====================================================================

create table if not exists public.carrier_relations (
  id         uuid primary key default gen_random_uuid(),
  carrier_a  text not null,
  carrier_b  text not null,
  label      text not null default '代理店',   -- 例：代理店／提携／グループ会社
  created_by text,
  created_at timestamptz not null default now(),
  check (carrier_a <> carrier_b)
);

create index if not exists idx_carrier_rel_a on public.carrier_relations (carrier_a);
create index if not exists idx_carrier_rel_b on public.carrier_relations (carrier_b);

grant select, insert, update, delete on public.carrier_relations to authenticated;

alter table public.carrier_relations enable row level security;

drop policy if exists "team read carrier relations" on public.carrier_relations;
create policy "team read carrier relations" on public.carrier_relations
  for select using (public.is_team_member());

drop policy if exists "team write carrier relations" on public.carrier_relations;
create policy "team write carrier relations" on public.carrier_relations
  for all using (public.is_team_member()) with check (public.is_team_member());
