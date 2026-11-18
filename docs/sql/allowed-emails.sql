-- =====================================================================
-- 許可リスト（allowed_emails）の鍵（RLS）— 記録用
-- =====================================================================
-- 位置づけ：
--   allowed_emails は「このアプリを使ってよい人（メンバー）」と役割（admin / member）の名簿。
--   ここを守れないと、誰でも自分を admin にしたり、他人を消したりできてしまうため、アプリで一番大事な鍵。
--   テーブルと is_team_member() / get_my_role() は Supabase ダッシュボードで作られており、リポジトリに定義が無かった。
--   2026-11-18 に本番の設定を pg_policies で確認し（4 つのポリシー・RLS 有効）、その内容をここに記録した。
--   → **本番はすでにこの設定。流す必要は無い**（環境を作り直す・別の確認用プロジェクトに同じ守りを作るときに使う）。
--   何回流しても同じ結果になる（drop policy if exists → create policy）。データは変えない。
--
-- 前提（ここでは作らない）：
--   ・テーブル public.allowed_emails（email, role, member_no など）
--   ・public.is_team_member() … 自分の email が allowed_emails にあるか（security definer）
--   ・public.get_my_role()    … 自分の role（security definer）。docs/アイデア台帳.md のロール管理の項に元の定義がある
--
-- 守りの中身：
--   読む   … チームメンバーだけ（許可リストに載っていない人は、Google でログインできても 0 件）
--   追加   … 管理者だけ
--   更新   … 管理者だけ（一般メンバーは、自分の役割を admin に書き換えられない）
--   削除   … 管理者だけ。ただし自分自身は消せない（最後の管理者が自分を消して、誰も管理できなくなる事故を防ぐ）
--
-- 確認の方法（読み取りだけ）：
--   select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'allowed_emails';
--   select relrowsecurity from pg_class where oid = 'public.allowed_emails'::regclass;   -- true であること
--   試験：bash scripts/design-tests/allowed-emails-sql-test.sh（使い捨ての PostgreSQL で 30 項目。鍵をわざと弱めた 4 通りを検出することも確認済み）
--
-- 今後の候補（まだやっていない・ここには書かない）：
--   ・最後の管理者が自分の役割を member に下げて、管理者がいなくなるのを防ぐ（更新時のトリガー）
--   ・get_my_role() / is_team_member() に search_path を固定する設定が付いているかの確認
--       select proname, prosecdef, proconfig from pg_proc where proname in ('get_my_role','is_team_member');
--   ・authenticated / anon から、使っていない権限（TRUNCATE・TRIGGER・REFERENCES）を外す
--       （全件消しは RLS が効かない操作。画面の API からは実行できないので実害は小さい）
-- =====================================================================

alter table public.allowed_emails enable row level security;

-- 読む：チームメンバーだけ
drop policy if exists "team can read members" on public.allowed_emails;
create policy "team can read members" on public.allowed_emails
  for select to authenticated
  using (public.is_team_member());

-- 追加：管理者だけ
drop policy if exists "admin can insert members" on public.allowed_emails;
create policy "admin can insert members" on public.allowed_emails
  for insert to authenticated
  with check (public.get_my_role() = 'admin');

-- 更新：管理者だけ（更新前の行も、更新後の行も、管理者の操作として確認する）
drop policy if exists "admin can update members" on public.allowed_emails;
create policy "admin can update members" on public.allowed_emails
  for update to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- 削除：管理者だけ・自分自身は消せない
drop policy if exists "admin can delete members" on public.allowed_emails;
create policy "admin can delete members" on public.allowed_emails
  for delete to authenticated
  using (public.get_my_role() = 'admin' and email <> auth.email());
