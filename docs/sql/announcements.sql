-- ============================================================
-- 📢 管理者からメンバーへの「お知らせ」
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：is_team_member()（チームメンバー判定）と get_my_role()（allowed_emails.role を返す）が作成済みであること
-- 未実行でもアプリは動く（お知らせが出ない・管理画面に「SQL が未実行」と出るだけ）。
-- ============================================================

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,
  level       text not null default 'info' check (level in ('info', 'important', 'maintenance')),
  starts_at   timestamptz not null default now(),   -- この時刻から表示（未来にすると予約）
  ends_at     timestamptz,                          -- この時刻まで表示（空＝終了させるまで出し続ける）
  created_by  text default (auth.jwt() ->> 'email'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists announcements_active_idx on public.announcements (starts_at, ends_at);

alter table public.announcements enable row level security;
grant select, insert, update, delete on public.announcements to authenticated;

-- 閲覧：チームメンバー全員（閲覧のみのロールも）
drop policy if exists "ann select" on public.announcements;
create policy "ann select" on public.announcements for select to authenticated
  using (is_team_member());

-- 作成・変更・削除：管理者だけ（UI の出し分けとは別に、サーバー側でも強制）
drop policy if exists "ann admin write" on public.announcements;
create policy "ann admin write" on public.announcements for all to authenticated
  using (coalesce(get_my_role(), 'member') = 'admin')
  with check (coalesce(get_my_role(), 'member') = 'admin');

-- 更新時刻の自動更新（内容を直すと、いったん閉じたメンバーにも再び表示される）
create or replace function public.announcements_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists announcements_touch_trg on public.announcements;
create trigger announcements_touch_trg before update on public.announcements
  for each row execute function public.announcements_touch();
