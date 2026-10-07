-- =====================================================================
-- bookmark_clicks: ブックマーク（チップ）のクリック数の記録・集計
-- =====================================================================
-- 目的：
--   よく使われる（人気の）ブックマークを把握し、チップをハイライトする。
--   クリックを1回1行で記録する。bookmarks 本体は更新しない
--   （編集履歴 bookmark_history を汚さないため）。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等）。
--
-- 前提：
--   ・public.bookmarks が存在すること
--   ・チーム判定関数 public.is_team_member() が存在すること
-- =====================================================================

create table if not exists public.bookmark_clicks (
  id          uuid primary key default gen_random_uuid(),
  bookmark_id uuid not null references public.bookmarks(id) on delete cascade,
  clicked_by  text not null,
  clicked_at  timestamptz not null default now()
);

create index if not exists idx_bm_clicks_bookmark on public.bookmark_clicks (bookmark_id);
create index if not exists idx_bm_clicks_at       on public.bookmark_clicks (clicked_at);

-- SQL Editor で作成したテーブルは authenticated への権限が自動付与されないため明示
grant select, insert on public.bookmark_clicks to authenticated;

alter table public.bookmark_clicks enable row level security;

-- 閲覧：チームメンバー全員
drop policy if exists "team read bm clicks" on public.bookmark_clicks;
create policy "team read bm clicks" on public.bookmark_clicks
  for select using (public.is_team_member());

-- 追加：自分のメールの行のみ（他人名義のクリックを水増しできない）
drop policy if exists "team insert own bm clicks" on public.bookmark_clicks;
create policy "team insert own bm clicks" on public.bookmark_clicks
  for insert with check (
    public.is_team_member() and clicked_by = (auth.jwt() ->> 'email')
  );

-- 集計：直近 p_days 日のクリック数（全体 total／自分 mine）をブックマークごとに返す。
-- 行数が増えても結果は「ブックマーク数ぶん」だけなので、クライアントに全行を渡さない。
-- security invoker なので RLS（チームメンバーのみ）がそのまま効く。
create or replace function public.bookmark_click_counts(p_days integer default 90)
returns table (bookmark_id uuid, total bigint, mine bigint)
language sql
stable
security invoker
as $$
  select c.bookmark_id,
         count(*)                                                    as total,
         count(*) filter (where c.clicked_by = (auth.jwt() ->> 'email')) as mine
  from public.bookmark_clicks c
  where c.clicked_at >= now() - make_interval(days => p_days)
  group by c.bookmark_id
$$;

grant execute on function public.bookmark_click_counts(integer) to authenticated;
