#!/usr/bin/env bash
# 作業カードの添付ファイルの SQL（docs/sql/ops-files.sql）を、使い捨ての PostgreSQL に Supabase の簡易な再現を作って流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で  bash scripts/sql-tests/ops-files-sql-test.sh
#   ※ 本物の Supabase ではない。RLS・列の権限・トリガー・掃除の論理を確かめるもので、保存領域 API 自体は確かめない。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="opf_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
export PGDATABASE="$DB"

$PSQL <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb $f$;
create table public.allowed_emails (email text primary key, role text);
create function public.is_team_member() returns boolean language sql security definer stable as
  $f$ select exists (select 1 from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email',''))) $f$;
create function public.get_my_role() returns text language sql security definer stable as
  $f$ select role from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email','')) $f$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant execute on function public.is_team_member(), public.get_my_role() to anon, authenticated;
insert into public.allowed_emails values ('alice@example.com','member'), ('bob@example.com','member'), ('admin@example.com','admin');
SQL

for i in 1 2; do $PSQL -f "$ROOT/docs/sql/ops-files.sql" >/dev/null 2>&1; done
echo "PASS SQL を 2 回流してもエラーなし（冪等）"

$PSQL <<'SQL'
create schema t;
create function t.as_user(p_email text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('email', p_email)::text, true);
  set local role authenticated;
end $f$;
create function t.ok(p_name text, p_cond boolean) returns void language plpgsql as $f$
begin
  if coalesce(p_cond, false) then raise notice 'PASS %', p_name; else raise exception 'FAIL %', p_name; end if;
end $f$;
create function t.err(p_name text, p_sql text, p_like text) returns void language plpgsql as $f$
declare m text;
begin
  begin execute p_sql; exception when others then m := sqlerrm; end;
  if m is null then raise exception 'FAIL %（エラーになるはずが成功した）', p_name; end if;
  if not exists (select 1 from unnest(string_to_array(p_like, '|')) k where m like '%' || k || '%') then
    raise exception 'FAIL %（別のエラー：%）', p_name, m;
  end if;
  raise notice 'PASS %', p_name;
end $f$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;
SQL

$PSQL <<'SQL' 2>&1 | sed -n 's/^psql:.*NOTICE:  //p; s/^NOTICE:  //p; /ERROR/p; /DETAIL/p; /CONTEXT/p'
do $$
declare MB bigint := 1048576; r public.ops_files; n int;
begin
  perform t.as_user('alice@example.com');
  -- 保存領域の API と同じく INSERT … RETURNING で置く（行がまだ無い 15 分以内のものは読める）
  insert into storage.objects (bucket_id, name, metadata) values ('ops-files', '202611/1_a_bl.pdf', jsonb_build_object('size', 2*MB)) returning name into r.storage_path;
  perform t.ok('置いたばかりで行の無いファイルも読み返せる（アップロードが通る）', r.storage_path is not null);
  perform t.err('決まった形でない保存場所は拒否', $q$insert into storage.objects (bucket_id, name, metadata) values ('ops-files', '../x.pdf', '{"size":1}') returning id$q$, 'row-level security');
  insert into public.ops_files (target, step_id, storage_path, file_name, mime_type) values ('q:A', 's1', '202611/1_a_bl.pdf', 'BLドラフト.pdf', 'application/pdf') returning * into r;
  perform t.ok('置いた人と大きさはサーバーが決める', r.uploaded_by = 'alice@example.com' and r.file_size = 2*MB);
  perform t.err('ファイル名に / は使えない', $q$insert into public.ops_files (target, step_id, storage_path, file_name) values ('q:A','s1','202611/1_a_bl.pdf','a/b')$q$, 'ファイル名');
  perform t.err('保存領域に無いファイルの行は作れない', $q$insert into public.ops_files (target, step_id, storage_path, file_name) values ('q:A','s1','202611/none.pdf','x.pdf')$q$, '見つかりません');
  insert into storage.objects (bucket_id, name, metadata) values ('ops-files', '202611/2_big.pdf', jsonb_build_object('size', 11*MB));
  perform t.err('10MB を超えるファイルは拒否', $q$insert into public.ops_files (target, step_id, storage_path, file_name) values ('q:A','s1','202611/2_big.pdf','big.pdf')$q$, '10MB');
  perform t.err('大きさを申告で書けない（列の権限）', $q$insert into public.ops_files (target, step_id, storage_path, file_name, file_size) values ('q:A','s1','202611/2_big.pdf','x.pdf', 1)$q$, 'permission denied');
  perform t.err('行は直せない', $q$update public.ops_files set file_name = 'x'$q$, 'permission denied');

  perform t.as_user('bob@example.com');
  select count(*) into n from public.ops_files where target = 'q:A';
  perform t.ok('ほかのメンバーも読める', n = 1);
  select count(*) into n from storage.objects where bucket_id = 'ops-files' and name = '202611/1_a_bl.pdf';
  perform t.ok('ほかのメンバーもファイルを読める（行がある）', n = 1);
  with d as (delete from storage.objects where name = '202611/1_a_bl.pdf' returning 1) select count(*) into n from d;
  perform t.ok('ほかの人のファイルは消せない（保存領域）', n = 0);
  with d as (delete from public.ops_files where target = 'q:A' returning 1) select count(*) into n from d;
  perform t.ok('ほかの人の行は消せない', n = 0);

  perform t.as_user('mallory@example.com');
  select count(*) into n from public.ops_files;
  perform t.ok('メンバーでない人は 0 件', n = 0);
  perform t.err('メンバーでない人は置けない', $q$insert into storage.objects (bucket_id, name, metadata) values ('ops-files', '202611/3_m.pdf', '{"size":1}') returning id$q$, 'row-level security');

  perform t.as_user('admin@example.com');
  with d as (delete from public.ops_files where target = 'q:A' returning 1) select count(*) into n from d;
  perform t.ok('管理者はほかの人の行を消せる', n = 1);
  with d as (delete from storage.objects where name = '202611/1_a_bl.pdf' returning 1) select count(*) into n from d;
  perform t.ok('管理者はほかの人のファイルも消せる', n = 1);

  perform t.as_user('alice@example.com');
  insert into storage.objects (bucket_id, name, metadata) values ('ops-files', '202611/4_own.pdf', jsonb_build_object('size', MB));
  insert into public.ops_files (target, step_id, storage_path, file_name) values ('j:J1', 's2', '202611/4_own.pdf', 'own.pdf');
  with d as (delete from storage.objects where name = '202611/4_own.pdf' returning 1) select count(*) into n from d;
  perform t.ok('置いた本人はファイルを消せる', n = 1);
  with d as (delete from public.ops_files where storage_path = '202611/4_own.pdf' returning 1) select count(*) into n from d;
  perform t.ok('置いた本人は行を消せる', n = 1);
  reset role;
end $$;
-- 掃除：行の無い古いファイルだけ消える
insert into storage.objects (bucket_id, name, metadata, created_at) values ('ops-files', '202611/old_orphan.pdf', '{"size":1}', now() - interval '1 hour'),
  ('ops-files', '202611/new_orphan.pdf', '{"size":1}', now()), ('quote-temp', 'x/old.pdf', '{"size":1}', now() - interval '1 hour');
select public.ops_files_purge();
do $$ begin
  perform t.ok('掃除：行の無い古いファイルは消え、置いたばかりのものとほかのバケットは残る',
    not exists (select 1 from storage.objects where name = '202611/old_orphan.pdf')
    and exists (select 1 from storage.objects where name = '202611/new_orphan.pdf')
    and exists (select 1 from storage.objects where name = 'x/old.pdf'));
end $$;
-- 50 ファイルの上限
do $$ declare i int; begin
  perform t.as_user('alice@example.com');
  for i in 1..50 loop
    insert into storage.objects (bucket_id, name, metadata) values ('ops-files', '202611/c' || i || '.pdf', '{"size":10}');
    insert into public.ops_files (target, step_id, storage_path, file_name) values ('q:C', 's1', '202611/c' || i || '.pdf', 'c.pdf');
  end loop;
  insert into storage.objects (bucket_id, name, metadata) values ('ops-files', '202611/c51.pdf', '{"size":10}');
  perform t.err('1 つの進行に 51 個目は付けられない', $q$insert into public.ops_files (target, step_id, storage_path, file_name) values ('q:C','s1','202611/c51.pdf','c.pdf')$q$, '50 ファイル');
  reset role;
end $$;
SQL
