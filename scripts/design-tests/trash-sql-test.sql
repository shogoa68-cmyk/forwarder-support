-- ゴミ箱（段階 1）SQL の試験。trash-sql-test.sh から呼ばれる（:target = docs/sql/trash-quote-presets.sql）
-- Supabase の代わりに、必要な部品（auth.email()・権限の関数・案件テーブル・編集ロックの RLS）を最小限で用意する。
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

-- ---- 部品（Supabase 側にあるものの代役） ----
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.email() returns text language sql stable
  as $$ select nullif(current_setting('test.email', true), '') $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.email() to anon, authenticated;

create table public.allowed_emails (email text primary key, role text not null default 'member');
insert into public.allowed_emails values ('alice@x', 'admin'), ('bob@x', 'member'), ('carol@x', 'member');
create function public.is_team_member() returns boolean language sql stable security definer
  as $$ select exists (select 1 from public.allowed_emails where email = auth.email()) $$;
create function public.get_my_role() returns text language sql stable security definer
  as $$ select role from public.allowed_emails where email = auth.email() $$;
grant execute on function public.is_team_member(), public.get_my_role() to anon, authenticated;

create table public.quote_presets (
  id uuid primary key default gen_random_uuid(),
  name text, data jsonb, status text,
  locked_by text, locked_at timestamptz, force_released_from text, force_released_at timestamptz,
  updated_at timestamptz default now());
create table public.quote_preset_links (
  id uuid primary key default gen_random_uuid(),
  preset_a uuid not null references public.quote_presets(id) on delete cascade,
  preset_b uuid not null references public.quote_presets(id) on delete cascade,
  note text, created_by text, created_at timestamptz default now(), check (preset_a <> preset_b));
grant select, insert, update, delete on public.quote_presets, public.quote_preset_links to authenticated;
alter table public.quote_presets enable row level security;
alter table public.quote_preset_links enable row level security;
create policy team_all on public.quote_presets for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy team_all on public.quote_preset_links for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
-- 本番と同じ編集ロックの守り（他の人が編集中の案件は消せない）
create policy lock_guard_delete on public.quote_presets as restrictive for delete to authenticated
  using (locked_by is null or locked_by = auth.email() or locked_at < now() - interval '90 seconds');

-- ---- 試験の道具 ----
create function public.t_ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'NG: %', msg; end if;
  raise warning 'ok  %', msg;
end $$;
create function public.t_as(who text) returns void language plpgsql as $$
begin perform set_config('test.email', who, false); end $$;

-- ---- 対象の SQL を流す。2 回流しても壊れない（冪等）ことも確かめる ----
\i :target
\i :target
select public.t_ok(true, '[0] ゴミ箱の SQL を 2 回流してもエラーにならない');

-- ---- データ ----
insert into public.quote_presets (id, name, data, status) values
  ('00000000-0000-0000-0000-000000000001', '案件A', '{"price":100}', 'draft'),
  ('00000000-0000-0000-0000-000000000002', '案件B', '{"price":200}', 'draft'),
  ('00000000-0000-0000-0000-000000000003', '案件C', '{"price":300}', 'draft');
insert into public.quote_preset_links (id, preset_a, preset_b, note) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'A-B'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'A-C');

-- [1] メンバーが案件を消す → 控えが残る（リンクも連鎖で）
-- 案件Aは本人（bob）が編集中。ロックの印が付いたまま消え、戻すときに空になることを [3] で確かめる
update public.quote_presets set locked_by = 'bob@x', locked_at = now() where id = '00000000-0000-0000-0000-000000000001';
set role authenticated;
select public.t_as('bob@x');
do $$ declare n int; begin
  delete from public.quote_presets where id = '00000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  perform public.t_ok(n = 1, '[1] 案件Aを削除できた');
end $$;
select public.t_ok((select count(*) from public.quote_presets where id = '00000000-0000-0000-0000-000000000001') = 0, '[1] 案件Aは本体から消えた');
select public.t_ok((select count(*) from public.quote_preset_links) = 0, '[1] リンクも連鎖で消えた');
select public.t_ok((select count(*) from public.trash where source_table = 'quote_presets' and label = '案件A' and deleted_by = 'bob@x' and (row_data->'data'->>'price') = '100') = 1, '[1] 案件Aの控え（名前・消した人・中身）がある');
select public.t_ok((select count(*) from public.trash where source_table = 'quote_preset_links') = 2, '[1] リンク2件の控えがある');
select public.t_ok((select expires_at - deleted_at from public.trash where label = '案件A') = interval '30 days', '[1] 保存期間は30日');

-- [2] 他の人が編集中の案件は消せない → 控えも作られない
reset role;
update public.quote_presets set locked_by = 'alice@x', locked_at = now() where id = '00000000-0000-0000-0000-000000000002';
set role authenticated;
select public.t_as('bob@x');
do $$ declare n int; before_n int; begin
  select count(*) into before_n from public.trash;
  delete from public.quote_presets where id = '00000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform public.t_ok(n = 0, '[2] 編集中（ロック中）の案件Bは消せない');
  perform public.t_ok((select count(*) from public.trash) = before_n, '[2] 消えなかった案件の控えは作られない');
end $$;

-- [3] 戻す（メンバー全員）。ロックは空に、リンクも一緒に戻る
reset role;
update public.quote_presets set locked_by = null, locked_at = null where id = '00000000-0000-0000-0000-000000000002';
set role authenticated;
select public.t_as('carol@x');
create temp table r1 as
  select public.trash_restore((select id from public.trash where label = '案件A')) as res;
reset role;
select public.t_ok((select res->>'status' from r1) = 'OK', '[3] 案件Aを戻せた');
select public.t_ok((select (res->>'restored')::int from r1) = 3, '[3] 案件A＋リンク2件＝3件が戻った');
select public.t_ok((select count(*) from public.quote_presets where id = '00000000-0000-0000-0000-000000000001' and (data->>'price') = '100' and locked_by is null) = 1, '[3] 中身が同じで、ロックは空');
select public.t_ok((select count(*) from public.quote_preset_links) = 2, '[3] リンク2件が戻った');
select public.t_ok((select count(*) from public.trash where restored_at is not null and restored_by = 'carol@x') = 3, '[3] 戻した人と日時が控えに残る');

-- [4] 二重に戻せない／権限／存在しない
set role authenticated;
select public.t_as('bob@x');
select public.t_ok(public.trash_restore((select id from public.trash where label = '案件A'))->>'status' = 'ALREADY', '[4] 戻し済みは ALREADY');
select public.t_ok(public.trash_restore(gen_random_uuid())->>'status' = 'NOTFOUND', '[4] 無い控えは NOTFOUND');
select public.t_as('eve@x');
select public.t_ok(public.trash_restore((select id from public.trash where label = '案件A'))->>'status' = 'DENIED', '[4] メンバー以外は DENIED');
select public.t_ok((select count(*) from public.trash) = 0, '[4] メンバー以外にはゴミ箱が見えない');

-- [5] 画面（authenticated）からはゴミ箱を直接書き換えられない
select public.t_as('bob@x');
do $$ begin
  begin insert into public.trash (source_table, source_id, row_data) values ('x','1','{}'); perform public.t_ok(false, '[5] 直接 insert できてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[5] 直接 insert は拒否'); end;
  begin delete from public.trash; perform public.t_ok(false, '[5] 直接 delete できてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[5] 直接 delete は拒否'); end;
  begin update public.trash set expires_at = now() + interval '999 days'; perform public.t_ok(false, '[5] 直接 update できてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[5] 直接 update は拒否'); end;
  begin perform public.purge_expired_trash(); perform public.t_ok(false, '[5] 掃除関数を画面から呼べてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[5] 掃除関数は画面から呼べない'); end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.trash_restore(gen_random_uuid()); perform public.t_ok(false, '[5] anon が戻せてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[5] ログインなしは戻せない'); end;
end $$;
reset role;

-- [6] 同じ id が今あると戻せない（CONFLICT）。何も変えない
set role authenticated;
select public.t_as('bob@x');
delete from public.quote_presets where id = '00000000-0000-0000-0000-000000000003';
reset role;
insert into public.quote_presets (id, name) values ('00000000-0000-0000-0000-000000000003', '同じidの別物');
create temp table r2 as
  select public.trash_restore((select id from public.trash where source_table = 'quote_presets' and label = '案件C' and restored_at is null)) as res;
select public.t_ok((select res->>'status' from r2) = 'CONFLICT', '[6] 同じ id があれば CONFLICT');
select public.t_ok((select name from public.quote_presets where id = '00000000-0000-0000-0000-000000000003') = '同じidの別物', '[6] 今ある行は書き換えない');
select public.t_ok((select count(*) from public.trash where label = '案件C' and restored_at is null) = 1, '[6] 控えは未復元のまま残る');

-- [7] 控えの保存に失敗したら、削除ごと止まる（控えが無いまま消えない）
alter table public.trash add constraint tmp_force_fail check (false) not valid;
set role authenticated;
select public.t_as('bob@x');
do $$ begin
  begin
    delete from public.quote_presets where id = '00000000-0000-0000-0000-000000000003';
    perform public.t_ok(false, '[7] 控えが作れないのに消えてはいけない');
  exception when check_violation then perform public.t_ok(true, '[7] 控えを作れないときは削除が止まる'); end;
end $$;
reset role;
select public.t_ok((select count(*) from public.quote_presets where id = '00000000-0000-0000-0000-000000000003') = 1, '[7] 案件は消えずに残っている');
alter table public.trash drop constraint tmp_force_fail;

-- [8] リンクだけ消す→相手が先に消えると PARENT_MISSING。相手を戻すとリンクも拾う
delete from public.trash;
insert into public.quote_presets (id, name) values
  ('00000000-0000-0000-0000-000000000004', '案件D'), ('00000000-0000-0000-0000-000000000005', '案件E');
insert into public.quote_preset_links (id, preset_a, preset_b, note)
  values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000005', 'D-E');
set role authenticated;
select public.t_as('bob@x');
delete from public.quote_preset_links where id = '00000000-0000-0000-0000-0000000000b1';
delete from public.quote_presets where id = '00000000-0000-0000-0000-000000000005';
select public.t_ok(public.trash_restore((select id from public.trash where source_table = 'quote_preset_links'))->>'status' = 'PARENT_MISSING', '[8] 相手の案件が無いリンクは PARENT_MISSING');
create temp table r3 as select public.trash_restore((select id from public.trash where label = '案件E')) as res;
reset role;
select public.t_ok((select (res->>'restored')::int from r3) = 2, '[8] 案件Eを戻すと、ゴミ箱のリンクも一緒に戻る');
select public.t_ok((select count(*) from public.quote_preset_links where id = '00000000-0000-0000-0000-0000000000b1') = 1, '[8] リンクが復活している');

-- [9] 完全に消せるのは管理者だけ。期限切れは戻せず、掃除で消える
set role authenticated;
select public.t_as('bob@x');
delete from public.quote_presets where id = '00000000-0000-0000-0000-000000000004';
create temp table t_row as select id from public.trash where label = '案件D' and restored_at is null;
select public.t_ok(public.trash_purge((select id from t_row)) = 'DENIED', '[9] メンバーは完全に消せない');
select public.t_as('alice@x');
select public.t_ok(public.trash_purge((select id from t_row)) = 'OK', '[9] 管理者は完全に消せる');
select public.t_ok(public.trash_purge((select id from t_row)) = 'NOTFOUND', '[9] 消したあとは NOTFOUND');
reset role;
delete from public.trash;
insert into public.quote_presets (id, name) values ('00000000-0000-0000-0000-000000000006', '案件F');
set role authenticated;
select public.t_as('bob@x');
delete from public.quote_presets where id = '00000000-0000-0000-0000-000000000006';
reset role;
update public.trash set expires_at = now() - interval '1 day' where label = '案件F';
set role authenticated;
select public.t_ok(public.trash_restore((select id from public.trash where label = '案件F'))->>'status' = 'EXPIRED', '[9] 期限切れは戻せない');
reset role;
select public.t_ok(public.purge_expired_trash() = 1, '[9] 掃除で期限切れの1件が消えた');
select public.t_ok((select count(*) from public.trash) = 0, '[9] ゴミ箱が空になった');

-- [10] 他のテーブル（対象外）の削除では控えを取らない
select public.t_ok((select count(*) from pg_trigger where tgname like 'trg_trash_%' and not tgisinternal) = 2, '[10] トリガーは案件とリンクの2つだけ');

select 'ALL PASSED' as result;
