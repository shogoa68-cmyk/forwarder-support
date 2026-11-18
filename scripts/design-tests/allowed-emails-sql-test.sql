-- 許可リスト（allowed_emails）の鍵の試験。allowed-emails-sql-test.sh から呼ばれる（:target = docs/sql/allowed-emails.sql）
-- Supabase の代わりに、必要な部品（auth.email()・is_team_member()・get_my_role()・テーブルと権限）を最小限で用意する。
-- 権限は本番に合わせる：authenticated は読む・追加・更新・削除の権限あり（止めているのは RLS だけ）／anon は権限なし。
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.email() returns text language sql stable
  as $$ select nullif(current_setting('test.email', true), '') $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.email() to anon, authenticated;

create table public.allowed_emails (email text primary key, role text not null default 'member', member_no int);
grant select, insert, update, delete on public.allowed_emails to authenticated;   -- 本番と同じ（止めるのは RLS）
create function public.is_team_member() returns boolean language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.allowed_emails where email = auth.email()) $$;
create function public.get_my_role() returns text language sql stable security definer set search_path = public
  as $$ select role from public.allowed_emails where email = auth.email() $$;
grant execute on function public.is_team_member(), public.get_my_role() to anon, authenticated;

create function public.t_ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'NG: %', msg; end if;
  raise warning 'ok  %', msg;
end $$;
create function public.t_as(who text) returns void language plpgsql as $$
begin perform set_config('test.email', who, false); end $$;

-- 2 回流しても壊れない（冪等）
\i :target
\i :target
select public.t_ok(true, '[0] SQL を 2 回流してもエラーにならない');

select public.t_ok((select relrowsecurity from pg_class where oid = 'public.allowed_emails'::regclass), '[0] RLS が有効');
select public.t_ok((select count(*) from pg_policies where tablename = 'allowed_emails') = 4, '[0] ポリシーは 4 つ（重複して増えない）');
select public.t_ok((select count(*) from pg_policies where tablename = 'allowed_emails' and cmd = 'SELECT') = 1
                 and (select count(*) from pg_policies where tablename = 'allowed_emails' and cmd = 'INSERT') = 1
                 and (select count(*) from pg_policies where tablename = 'allowed_emails' and cmd = 'UPDATE') = 1
                 and (select count(*) from pg_policies where tablename = 'allowed_emails' and cmd = 'DELETE') = 1, '[0] 読む・追加・更新・削除が 1 つずつ');
select public.t_ok((select bool_and(roles = '{authenticated}') from pg_policies where tablename = 'allowed_emails'), '[0] すべて authenticated 向け（anon には何も許さない）');

-- 名簿：管理者 alice・一般メンバー bob / carol（eve は名簿に無い＝Google でログインしただけの人）
insert into public.allowed_emails (email, role, member_no) values ('alice@x', 'admin', 1), ('bob@x', 'member', 2), ('carol@x', 'member', 3);

-- ---- 管理者 ----
set role authenticated;
select public.t_as('alice@x');
select public.t_ok((select count(*) from public.allowed_emails) = 3, '[管理者] 全員を読める');
do $$ declare n int; begin
  insert into public.allowed_emails (email, role) values ('dave@x', 'member');
  perform public.t_ok(true, '[管理者] メンバーを追加できる');
  update public.allowed_emails set role = 'admin' where email = 'dave@x'; get diagnostics n = row_count;
  perform public.t_ok(n = 1, '[管理者] 他人の役割を変えられる');
  delete from public.allowed_emails where email = 'dave@x'; get diagnostics n = row_count;
  perform public.t_ok(n = 1, '[管理者] 他人を消せる');
  delete from public.allowed_emails where email = 'alice@x'; get diagnostics n = row_count;
  perform public.t_ok(n = 0, '[管理者] 自分自身は消せない（最後の管理者が消える事故を防ぐ）');
end $$;
reset role;
select public.t_ok((select count(*) from public.allowed_emails where email = 'alice@x') = 1, '[管理者] 自分の行は残っている');

-- ---- 一般メンバー bob：読めるだけ ----
set role authenticated;
select public.t_as('bob@x');
select public.t_ok((select count(*) from public.allowed_emails) = 3, '[一般] 名簿は読める');
do $$ declare n int; begin
  update public.allowed_emails set role = 'admin' where email = 'bob@x'; get diagnostics n = row_count;
  perform public.t_ok(n = 0, '[一般] 自分を admin に書き換えられない（0 行）');
  update public.allowed_emails set role = 'member' where email = 'alice@x'; get diagnostics n = row_count;
  perform public.t_ok(n = 0, '[一般] 管理者の役割を変えられない');
  update public.allowed_emails set email = 'bob2@x' where email = 'bob@x'; get diagnostics n = row_count;
  perform public.t_ok(n = 0, '[一般] 自分のメールの書き換えもできない');
  delete from public.allowed_emails where email <> 'bob@x'; get diagnostics n = row_count;
  perform public.t_ok(n = 0, '[一般] 他人を消せない');
  delete from public.allowed_emails where email = 'bob@x'; get diagnostics n = row_count;
  perform public.t_ok(n = 0, '[一般] 自分も消せない');
  begin insert into public.allowed_emails (email, role) values ('bob+evil@x', 'admin'); perform public.t_ok(false, '[一般] 追加できてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[一般] 自分で別の admin を追加できない（拒否）'); end;
  begin insert into public.allowed_emails (email, role) values ('bob+m@x', 'member'); perform public.t_ok(false, '[一般] member でも追加できてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[一般] member の追加も拒否'); end;
end $$;
reset role;
select public.t_ok((select role from public.allowed_emails where email = 'bob@x') = 'member', '[一般] 試したあとも bob は member のまま');
select public.t_ok((select count(*) from public.allowed_emails) = 3, '[一般] 名簿は 3 件のまま');

-- ---- 名簿に無い人 eve（Google でログインしただけ）：何も見えない・何もできない ----
set role authenticated;
select public.t_as('eve@x');
select public.t_ok((select count(*) from public.allowed_emails) = 0, '[名簿外] 名簿が 1 件も見えない');
do $$ declare n int; begin
  update public.allowed_emails set role = 'admin'; get diagnostics n = row_count;
  perform public.t_ok(n = 0, '[名簿外] 更新できない');
  delete from public.allowed_emails; get diagnostics n = row_count;
  perform public.t_ok(n = 0, '[名簿外] 消せない');
  begin insert into public.allowed_emails (email, role) values ('eve@x', 'admin'); perform public.t_ok(false, '[名簿外] 自分を追加できてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[名簿外] 自分を admin として追加できない（拒否）'); end;
end $$;
reset role;
select public.t_ok((select count(*) from public.allowed_emails) = 3, '[名簿外] 試したあとも名簿は 3 件のまま');

-- ---- ログインなし（anon） ----
set role anon;
do $$ begin
  begin perform count(*) from public.allowed_emails; perform public.t_ok(false, '[anon] 読めてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[anon] 読めない'); end;
  begin delete from public.allowed_emails; perform public.t_ok(false, '[anon] 消せてはいけない');
  exception when insufficient_privilege then perform public.t_ok(true, '[anon] 消せない'); end;
end $$;
reset role;

-- ---- 名簿の変更が反映される（役割を昇格させると、その人は管理者としてふるまえる） ----
set role authenticated;
select public.t_as('alice@x');
update public.allowed_emails set role = 'admin' where email = 'carol@x';
select public.t_as('carol@x');
select public.t_ok(public.get_my_role() = 'admin', '[反映] 管理者が昇格させた carol は、管理者として扱われる');
do $$ declare n int; begin
  delete from public.allowed_emails where email = 'bob@x'; get diagnostics n = row_count;
  perform public.t_ok(n = 1, '[反映] 昇格した carol は他人を消せる');
end $$;
reset role;

select 'ALL PASSED' as result;
