-- =====================================================================
-- bookmarks 全面クラウド移行 ＋ 編集履歴（トリガー自動記録）  フェーズ1
-- =====================================================================
-- 目的：
--   ・船会社リンク（内蔵DB）を bookmarks テーブルへ一元化する前提として、
--     更新者・更新時刻列と「編集履歴」基盤を用意する。
--   ・チーム編集のため、INSERT/UPDATE/DELETE を自動で履歴に残す。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run。
--   （何度流しても安全なように IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS で冪等化）
--
-- 前提：
--   ・既存テーブル public.bookmarks が存在すること
--   ・チーム判定関数 public.is_team_member()（quote_presets で使用中のもの）が存在すること
--     （無い場合は RLS ポリシー部分でエラーになるので、先に is_team_member() を用意する）
-- =====================================================================

-- 1) bookmarks に「最終更新者・最終更新時刻」列を追加 -------------------
alter table public.bookmarks
  add column if not exists updated_by text,
  add column if not exists updated_at timestamptz default now();

-- 2) 編集履歴テーブル --------------------------------------------------
create table if not exists public.bookmark_history (
  id          uuid primary key default gen_random_uuid(),
  bookmark_id uuid,                                  -- 対象ブックマーク（削除後も値は残す）
  action      text not null,                         -- 'INSERT' / 'UPDATE' / 'DELETE'
  changed_by  text,                                  -- 実行者メール（auth.jwt から取得）
  changed_at  timestamptz not null default now(),
  old_data    jsonb,                                 -- 変更前スナップショット（INSERT 時は null）
  new_data    jsonb                                  -- 変更後スナップショット（DELETE 時は null）
);

create index if not exists idx_bm_hist_bookmark
  on public.bookmark_history (bookmark_id, changed_at desc);

-- 3) 変更を自動記録するトリガー関数 -----------------------------------
--    security definer：履歴テーブルへの書込はこの関数経由のみ許可する。
create or replace function public.log_bookmark_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
begin
  -- 実行ユーザーのメール（未ログイン/サービスロール時は null）
  actor := auth.jwt() ->> 'email';

  if (tg_op = 'INSERT') then
    new.updated_by := actor;
    new.updated_at := now();
    insert into public.bookmark_history (bookmark_id, action, changed_by, new_data)
      values (new.id, 'INSERT', actor, to_jsonb(new));
    return new;

  elsif (tg_op = 'UPDATE') then
    new.updated_by := actor;
    new.updated_at := now();
    insert into public.bookmark_history (bookmark_id, action, changed_by, old_data, new_data)
      values (new.id, 'UPDATE', actor, to_jsonb(old), to_jsonb(new));
    return new;

  else  -- DELETE
    insert into public.bookmark_history (bookmark_id, action, changed_by, old_data)
      values (old.id, 'DELETE', actor, to_jsonb(old));
    return old;
  end if;
end;
$$;

-- 4) トリガー登録 -----------------------------------------------------
--    INSERT/UPDATE は BEFORE（updated_by/updated_at を書き換えるため）、
--    DELETE は AFTER（行確定後にスナップショットを記録）。
drop trigger if exists trg_bm_log_iu on public.bookmarks;
create trigger trg_bm_log_iu
  before insert or update on public.bookmarks
  for each row execute function public.log_bookmark_change();

drop trigger if exists trg_bm_log_d on public.bookmarks;
create trigger trg_bm_log_d
  after delete on public.bookmarks
  for each row execute function public.log_bookmark_change();

-- 5) RLS：履歴はチームメンバーが閲覧可。書込はトリガー(security definer)のみ ---
alter table public.bookmark_history enable row level security;

drop policy if exists "team read bm history" on public.bookmark_history;
create policy "team read bm history" on public.bookmark_history
  for select using (public.is_team_member());

-- =====================================================================
-- 動作確認（任意）：
--   -- 列が増えたか
--   select column_name from information_schema.columns
--     where table_name = 'bookmarks' and column_name in ('updated_by','updated_at');
--   -- 1件更新してみて履歴が積まれるか
--   update public.bookmarks set note = note where id = '<任意のid>';
--   select action, changed_by, changed_at from public.bookmark_history
--     order by changed_at desc limit 5;
-- =====================================================================
