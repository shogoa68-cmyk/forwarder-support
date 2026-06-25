-- =====================================================================
-- bookmarks: UPDATE 用 RLS ポリシーの追加（編集が保存されない不具合の修正）
-- =====================================================================
-- 症状：
--   BOOKMARK タブ（および見積タブのリンクチップ）でブックマークを編集して
--   「保存」しても反映されない。再読み込みしても古いまま。
--
-- 原因：
--   public.bookmarks の RLS ポリシーが SELECT(r) / INSERT(a) / DELETE(d) の
--   3 つのみで、UPDATE(w) 用ポリシーが存在しなかった。RLS 有効テーブルで
--   該当コマンドのポリシーが無いと、その操作は 0 行に弾かれる。
--   フロントの .update() は .select() を付けないと 0 行でも error=null を返すため、
--   「✅ 更新しました」と誤表示されていた（フロント側は別途 .select() ガードを追加）。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run。
--   （IF EXISTS / 再作成で冪等。何度流しても安全）
--
-- 前提：
--   ・チーム判定関数 public.is_team_member() が存在すること（既存の他ポリシーと同じ）。
-- =====================================================================

-- UPDATE：チームメンバーは編集可。
--   using      … 更新対象の既存行を選べるか（SELECT と同条件）
--   with check … 更新後の行が条件を満たすか
drop policy if exists "team members can update bookmarks" on public.bookmarks;
create policy "team members can update bookmarks" on public.bookmarks
  for update using (public.is_team_member())
              with check (public.is_team_member());

-- =====================================================================
-- 確認（任意）：UPDATE(w) ポリシーが追加されたか
--   select polname, polcmd from pg_policy
--     where polrelid = 'public.bookmarks'::regclass order by polcmd;
-- =====================================================================
