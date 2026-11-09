-- 別名（synonym_groups）を、マスターの承認制に合わせる
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
--
-- 前提: docs/sql/master-approval.sql を実行済み（master_requests がある）／docs/supabase-synonym-groups-setup.sql を実行済み
--
-- 変わること
--   ・master_requests に alias_of 列を追加：メンバーが出す「別名の追加申請」
--     （value＝別名にしたい名前、alias_of＝入れ先のマスター名）。管理者が承認すると別名として反映される
--   ・synonym_groups（別名・マスター名の変更）の書き込みを管理者だけにする（読むのはこれまでどおり全メンバー）
--     → 承認制なのに、メンバーが別名の追加経由でマスターの候補を増減できる抜け道を塞ぐ
-- 元に戻すとき（承認制をやめるとき）は、末尾のコメントの SQL を実行する

do $$
begin
  if to_regclass('public.master_requests') is null then
    raise exception 'master_requests がありません。先に docs/sql/master-approval.sql を実行してください';
  end if;
  if to_regclass('public.synonym_groups') is null then
    raise exception 'synonym_groups がありません。先に docs/supabase-synonym-groups-setup.sql を実行してください';
  end if;
end $$;

alter table public.master_requests add column if not exists alias_of text;   -- null＝マスターの申請／値あり＝別名の追加申請

drop policy if exists "team members can insert synonym_groups" on public.synonym_groups;
drop policy if exists "team members can update synonym_groups" on public.synonym_groups;
drop policy if exists "team members can delete synonym_groups" on public.synonym_groups;
drop policy if exists "admins can insert synonym_groups" on public.synonym_groups;
drop policy if exists "admins can update synonym_groups" on public.synonym_groups;
drop policy if exists "admins can delete synonym_groups" on public.synonym_groups;

create policy "admins can insert synonym_groups" on public.synonym_groups
  for insert with check (is_team_member() and get_my_role() = 'admin');
create policy "admins can update synonym_groups" on public.synonym_groups
  for update using (is_team_member() and get_my_role() = 'admin')
  with check (is_team_member() and get_my_role() = 'admin');
create policy "admins can delete synonym_groups" on public.synonym_groups
  for delete using (is_team_member() and get_my_role() = 'admin');

-- ===== 元に戻す（承認制をやめて、メンバーも別名を直接追加できるようにする）=====
-- drop policy if exists "admins can insert synonym_groups" on public.synonym_groups;
-- drop policy if exists "admins can update synonym_groups" on public.synonym_groups;
-- drop policy if exists "admins can delete synonym_groups" on public.synonym_groups;
-- create policy "team members can insert synonym_groups" on public.synonym_groups for insert with check (is_team_member());
-- create policy "team members can update synonym_groups" on public.synonym_groups for update using (is_team_member()) with check (is_team_member());
-- create policy "team members can delete synonym_groups" on public.synonym_groups for delete using (is_team_member());
