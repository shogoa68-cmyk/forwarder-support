-- ============================================================
-- 🔍 ゆらぎチェックの記録（チーム共有）
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：is_team_member()（チームメンバー判定）と get_my_role()（allowed_emails.role を返す）が作成済みであること
-- 未実行でもアプリは動く（記録はこの端末のブラウザだけに残り、他の管理者とは共有されない）。
--
-- 何を記録するか（追記のみ・書き換えや削除はしない）
--   alias   別名を登録した（mode＝auto 自動／manual 手動）
--   undo    登録した別名を元に戻した（同じ別名を自動で付け直さないための目印）
--   dismiss 「別物」と決めた組（候補に出さないための目印）
--   run     自動チェックを実行した（前回の実行日時＝管理者が何人いても週 1 回だけ走らせるため）
-- ============================================================

create table if not exists public.drift_log (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('alias', 'undo', 'dismiss', 'run')),
  mode       text check (mode in ('auto', 'manual')),
  field      text,
  alias      text,
  canonical  text,
  by         text default (auth.jwt() ->> 'email'),
  note       text
);
create index if not exists drift_log_at_idx on public.drift_log (at desc);

alter table public.drift_log enable row level security;
-- 追記のみ：更新・削除の権限は渡さない
revoke all on public.drift_log from anon;
revoke update, delete on public.drift_log from authenticated;
grant select, insert on public.drift_log to authenticated;

-- 閲覧：チームメンバー全員
drop policy if exists "drift select" on public.drift_log;
create policy "drift select" on public.drift_log for select to authenticated
  using (is_team_member());

-- 追記：「別物」はメンバーでも記録できる。登録・元に戻す・実行記録は管理者だけ（UI の出し分けとは別に、サーバー側でも強制）
drop policy if exists "drift insert" on public.drift_log;
create policy "drift insert" on public.drift_log for insert to authenticated
  with check (
    is_team_member()
    and (kind = 'dismiss' or coalesce(get_my_role(), 'member') = 'admin')
    and by = (auth.jwt() ->> 'email')   -- 他人の名前で記録できない
  );
