-- =====================================================================
-- bookmarks: リンク確認（人による「確認済み」記録）テーブル
-- =====================================================================
-- 目的：
--   ブックマークのリンクが正しいことを「人が確認した」記録を残す。
--   ・誰が・いつ確認したかを記録
--   ・複数人が確認することで信頼性を可視化（人数で表示）
--   自動のリンク切れ検査ではなく、手動の確認記録。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等）。
--
-- 前提：
--   ・public.bookmarks が存在すること
--   ・チーム判定関数 public.is_team_member() が存在すること
-- =====================================================================

create table if not exists public.bookmark_verifications (
  id          uuid primary key default gen_random_uuid(),
  bookmark_id uuid not null references public.bookmarks(id) on delete cascade,
  checked_by  text not null,                       -- 確認者メール
  checked_at  timestamptz not null default now(),
  unique (bookmark_id, checked_by)                 -- 1人1ブックマークにつき1回
);

create index if not exists idx_bm_verif_bookmark
  on public.bookmark_verifications (bookmark_id);

alter table public.bookmark_verifications enable row level security;

-- 閲覧：チームメンバーは全件閲覧可
drop policy if exists "team read bm verif" on public.bookmark_verifications;
create policy "team read bm verif" on public.bookmark_verifications
  for select using (public.is_team_member());

-- 追加：自分のメールの行のみ（他人になりすました確認を防ぐ）
drop policy if exists "team insert own bm verif" on public.bookmark_verifications;
create policy "team insert own bm verif" on public.bookmark_verifications
  for insert with check (
    public.is_team_member() and checked_by = (auth.jwt() ->> 'email')
  );

-- 取消：自分のメールの行のみ削除可
drop policy if exists "team delete own bm verif" on public.bookmark_verifications;
create policy "team delete own bm verif" on public.bookmark_verifications
  for delete using (
    public.is_team_member() and checked_by = (auth.jwt() ->> 'email')
  );
