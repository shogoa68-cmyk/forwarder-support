-- ============================================================
-- 不具合報告：やりとり（管理者→報告者への質問／報告者の返信／コメント）と「確認待ち」状態
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：feedbacks テーブル（feedback-reports.sql 適用済み）・is_team_member() 関数
-- 未適用でもアプリは動く（やりとり欄が出ないだけ）。
-- ============================================================

-- ① コメント（スレッド）
--   kind: 'question'＝チームメンバー→報告者への質問 ／ 'answer'＝報告者の返信 ／ 'comment'＝ふつうのコメント
create table if not exists public.feedback_comments (
  id            uuid primary key default gen_random_uuid(),
  feedback_id   uuid not null references public.feedbacks(id) on delete cascade,
  kind          text not null default 'comment',
  body          text not null,
  author_id     uuid references auth.users(id) on delete set null,
  author_email  text,
  created_at    timestamptz not null default now()
);
create index if not exists feedback_comments_fb_idx on public.feedback_comments (feedback_id, created_at);

alter table public.feedback_comments enable row level security;
grant select, insert on public.feedback_comments to authenticated;

-- ② 閲覧：チームメンバー全員、または その報告の本人（報告者）
drop policy if exists "fbc select" on public.feedback_comments;
create policy "fbc select" on public.feedback_comments for select to authenticated
  using (
    is_team_member()
    or exists (select 1 from public.feedbacks f where f.id = feedback_id and f.user_id = auth.uid())
  );

-- ③ 追加：本人名義で。質問はチームメンバーだけ／返信は報告者本人だけ／コメントはどちらでも
drop policy if exists "fbc insert" on public.feedback_comments;
create policy "fbc insert" on public.feedback_comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and (author_email is null or author_email = auth.email())   -- 他人のメールを名乗れないように
    and (
      (kind = 'question' and is_team_member())
      or (kind = 'answer'   and exists (select 1 from public.feedbacks f where f.id = feedback_id and f.user_id = auth.uid()))
      or (kind = 'comment'  and (is_team_member()
                                 or exists (select 1 from public.feedbacks f where f.id = feedback_id and f.user_id = auth.uid())))
    )
  );

-- ④ 状態の自動切替：質問を送ると「確認待ち(need_info)」、報告者が返信すると「未対応(open)」に戻る
--   （報告者は feedbacks を更新できないので security definer のトリガーで行う）
create or replace function public.feedback_comment_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'question' then
    update public.feedbacks set status = 'need_info'
      where id = new.feedback_id and status in ('open', 'in_progress');
  elsif new.kind = 'answer' then
    update public.feedbacks set status = 'open'
      where id = new.feedback_id and status = 'need_info';
  end if;
  return new;
end; $$;
drop trigger if exists feedback_comment_after_insert_trg on public.feedback_comments;
create trigger feedback_comment_after_insert_trg after insert on public.feedback_comments
  for each row execute function public.feedback_comment_after_insert();

-- ⑤ 報告者が「自分の報告」を読めるように（既存ポリシーの再作成・冪等）。
--   画面の通知バッジ（自分の報告の確認待ち件数）はこれで数える
grant select on public.feedbacks to authenticated;
drop policy if exists "users can view own feedbacks" on public.feedbacks;
create policy "users can view own feedbacks" on public.feedbacks for select to authenticated
  using (user_id = auth.uid());
