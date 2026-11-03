-- ============================================================
-- 💡 アイデア：「いいね（👍）」投票
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：feedbacks テーブル（feedback-reports.sql 適用済み）・is_team_member() 関数
-- 未適用でもアプリは動く（アイデアの投稿・一覧・対応状況はそのまま使え、👍 ボタンだけ出ない）。
-- ============================================================

-- 1 人 1 アイデアにつき 1 票（取り消し可）
create table if not exists public.feedback_votes (
  feedback_id  uuid not null references public.feedbacks(id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (feedback_id, user_id)
);
create index if not exists feedback_votes_fb_idx on public.feedback_votes (feedback_id);

alter table public.feedback_votes enable row level security;
grant select, insert, delete on public.feedback_votes to authenticated;

-- 閲覧：チームメンバー全員（誰が投票したかは画面に出さず、件数と「自分が投票済みか」だけ使う）
drop policy if exists "fbv select" on public.feedback_votes;
create policy "fbv select" on public.feedback_votes for select to authenticated
  using (is_team_member());

-- 追加：チームメンバーが本人名義で
drop policy if exists "fbv insert" on public.feedback_votes;
create policy "fbv insert" on public.feedback_votes for insert to authenticated
  with check (is_team_member() and user_id = auth.uid());

-- 取り消し：本人の票だけ
drop policy if exists "fbv delete" on public.feedback_votes;
create policy "fbv delete" on public.feedback_votes for delete to authenticated
  using (user_id = auth.uid());
