#!/usr/bin/env bash
# 一時ファイル置き場の SQL（docs/sql/quote-temp-files.sql）を、使い捨ての PostgreSQL に
# 「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で
#     bash scripts/sql-tests/quote-temp-files-sql-test.sh
#   ※ 本物の Supabase ではない。RLS・列の権限・トリガー・掃除の論理を確かめるもので、保存領域 API 自体は確かめない。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="qtf_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
export PGDATABASE="$DB"

$PSQL <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb $f$;
create table public.allowed_emails (email text primary key);
create function public.is_team_member() returns boolean language sql security definer stable as
  $f$ select exists (select 1 from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email',''))) $f$;
create table public.quote_presets (id uuid primary key default gen_random_uuid(), name text);
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on public.quote_presets to authenticated;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function public.is_team_member() to anon, authenticated, service_role;
insert into public.allowed_emails values ('alice@example.com'), ('bob@example.com');
insert into public.quote_presets (id, name) values ('00000000-0000-0000-0000-0000000000a1', '案件A'), ('00000000-0000-0000-0000-0000000000b2', '案件B');
SQL

for i in 1 2; do $PSQL -f "$ROOT/docs/sql/quote-temp-files.sql" >/dev/null 2>&1; done
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
declare
  A uuid := '00000000-0000-0000-0000-0000000000a1';
  B uuid := '00000000-0000-0000-0000-0000000000b2';
  MB bigint := 1048576;
  r public.quote_temp_files; n int; p1 text; p2 text;
begin
  perform t.as_user('alice@example.com');
  p1 := A || '/1_x_plan.pdf';
  -- 先に保存領域へ置く
  -- 保存領域の API は INSERT … RETURNING で書く（SELECT のポリシーも通る必要がある）。以前はここで拒否されていた
  perform t.err('（旧不具合の再現）行がまだ無い置いたばかりのファイルでも、RETURNING つきの INSERT が通る',
    format($q$with i as (insert into storage.objects (bucket_id, name, metadata) values ('quote-temp', %L, '{"size":1}') returning name) select 1/0 from i$q$, A || '/ret.bin'), 'division by zero');
  delete from storage.objects where name = A || '/ret.bin';
  insert into storage.objects (bucket_id, name, metadata) values ('quote-temp', p1, jsonb_build_object('size', 3 * MB));
  perform t.ok('案件のフォルダ名の形なら、保存領域に置ける', true);
  perform t.err('案件のフォルダ名でない場所には置けない', $q$insert into storage.objects (bucket_id, name, metadata) values ('quote-temp', 'x/y.pdf', '{"size":1}')$q$, 'row-level security');
  perform t.err('日本語など ASCII 以外の保存名は拒否', format($q$insert into storage.objects (bucket_id, name, metadata) values ('quote-temp', %L, '{"size":1}')$q$, A || '/資料.pdf'), 'row-level security');

  insert into public.quote_temp_files (preset_id, storage_path, file_name, mime_type) values (A, p1, '工程スケジュール.pdf', 'application/pdf') returning * into r;
  perform t.ok('行を作ると 3 時間後が期限・作成者・実際の大きさがサーバーで入る',
    r.expires_at between now() + interval '2 hours 59 minutes' and now() + interval '3 hours 1 minute'
    and r.uploaded_by = 'alice@example.com' and r.file_size = 3 * MB);

  perform t.err('画面から期限（expires_at）は指定できない', format($q$insert into public.quote_temp_files (preset_id, storage_path, file_name, expires_at) values (%L, %L, 'a', now() + interval '99 days')$q$, A, A || '/1_x_plan.pdf'), 'permission denied');
  perform t.err('画面から期限は延ばせない（update）', format($q$update public.quote_temp_files set expires_at = now() + interval '99 days' where id = %L$q$, r.id), 'permission denied');
  perform t.err('画面から大きさは書き換えられない', format($q$update public.quote_temp_files set file_size = 1 where id = %L$q$, r.id), 'permission denied');
  update public.quote_temp_files set file_name = '工程表（改）.pdf' where id = r.id;
  select * into r from public.quote_temp_files where id = r.id;
  perform t.ok('表示名は変えられる', r.file_name = '工程表（改）.pdf');
  perform t.err('ファイルが先に置かれていない行は作れない', format($q$insert into public.quote_temp_files (preset_id, storage_path, file_name) values (%L, %L, 'z')$q$, A, A || '/none.pdf'), 'ファイルが見つかりません');
  perform t.err('名前に / は使えない', format($q$insert into public.quote_temp_files (preset_id, storage_path, file_name) values (%L, %L, 'a/b')$q$, A, p1), 'ファイル名');

  -- 申告ではなく実際の大きさ・上限
  insert into storage.objects (bucket_id, name, metadata) values ('quote-temp', A || '/2_big.bin', jsonb_build_object('size', 26 * MB));
  perform t.err('1 ファイル 25MB を超えると拒否', format($q$insert into public.quote_temp_files (preset_id, storage_path, file_name) values (%L, %L, 'big')$q$, A, A || '/2_big.bin'), '25MB');
  delete from storage.objects where name = A || '/2_big.bin';
  for n in 1..4 loop
    insert into storage.objects (bucket_id, name, metadata) values ('quote-temp', A || '/f' || n || '.bin', jsonb_build_object('size', 24 * MB));
    insert into public.quote_temp_files (preset_id, storage_path, file_name) values (A, A || '/f' || n || '.bin', 'f' || n);
  end loop;   -- 3 + 24×4 = 99MB
  insert into storage.objects (bucket_id, name, metadata) values ('quote-temp', A || '/f5.bin', jsonb_build_object('size', 2 * MB));
  perform t.err('1 案件の合計 100MB を超えると拒否', format($q$insert into public.quote_temp_files (preset_id, storage_path, file_name) values (%L, %L, 'f5')$q$, A, A || '/f5.bin'), '100MB');

  -- 見える範囲
  select count(*) into n from public.quote_temp_files where preset_id = A;
  perform t.ok('案件 A の一覧は 5 件', n = 5);
  perform t.as_user('bob@example.com');
  select count(*) into n from public.quote_temp_files where preset_id = A;
  perform t.ok('別のチームメンバーも見える', n = 5);
  perform t.as_user('mallory@example.com');
  select count(*) into n from public.quote_temp_files;
  perform t.ok('チーム外の人には見えない', n = 0);
  perform t.err('チーム外の人は置けない', format($q$insert into storage.objects (bucket_id, name, metadata) values ('quote-temp', %L, '{"size":1}')$q$, B || '/m.pdf'), 'row-level security');

  -- 保存領域の読み取り
  perform t.as_user('bob@example.com');
  select count(*) into n from storage.objects where bucket_id = 'quote-temp' and name = p1;
  perform t.ok('期限内のファイルは保存領域から読める', n = 1);

  -- 期限切れ：一覧・保存領域の両方から見えなくなる
  reset role;
  update public.quote_temp_files set expires_at = now() - interval '1 minute' where storage_path = p1;
  perform t.as_user('alice@example.com');
  select count(*) into n from public.quote_temp_files where storage_path = p1;
  perform t.ok('期限が来たファイルは一覧に出ない（掃除を待たない）', n = 0);
  select count(*) into n from storage.objects where bucket_id = 'quote-temp' and name = p1;
  perform t.ok('期限が来たファイルは保存領域からも読めない', n = 0);
  update public.quote_temp_files set file_name = 'x' where storage_path = p1;
  get diagnostics n = row_count;
  perform t.ok('期限切れの行の名前は変えられない（0 行）', n = 0);
end $$;
SQL
SQL_STATUS=${PIPESTATUS[0]}
echo "(前半 完了)"

$PSQL <<'SQL' 2>&1 | sed -n 's/^psql:.*NOTICE:  //p; s/^NOTICE:  //p; /ERROR/p; /DETAIL/p; /CONTEXT/p'
do $$
declare
  A uuid := '00000000-0000-0000-0000-0000000000a1';
  p1 text := A || '/1_x_plan.pdf'; n int; orphan text := A || '/orphan.bin'; fresh text := A || '/fresh.bin';
begin
  reset role;
  -- 掃除：期限切れの行・古い実体・行のない古いファイルを消し、新しいものは残す
  insert into storage.objects (bucket_id, name, metadata, created_at) values ('quote-temp', orphan, '{"size":1}', now() - interval '20 minutes');
  insert into storage.objects (bucket_id, name, metadata, created_at) values ('quote-temp', fresh, '{"size":1}', now() - interval '1 minute');
  update storage.objects set created_at = now() - interval '3 hours 1 minute' where name = p1;   -- 期限が来たばかり（3 時間 10 分は経っていない）
  perform public.quote_temp_files_purge();
  select count(*) into n from public.quote_temp_files where storage_path = p1;
  perform t.ok('掃除：期限切れの行が消える', n = 0);
  select count(*) into n from storage.objects where name = p1;
  perform t.ok('掃除：古い実体が消える', n = 0);
  select count(*) into n from storage.objects where name = orphan;
  perform t.ok('掃除：行のない古いファイル（アップロード失敗の残り）が消える', n = 0);
  select count(*) into n from storage.objects where name = fresh;
  perform t.ok('掃除：置いたばかりのファイル（まだ行を作る前かもしれない）は残る', n = 1);
  select count(*) into n from public.quote_temp_files;
  perform t.ok('掃除：期限内の行は残る', n = 4);
  -- 案件を消すと一緒に消える
  delete from public.quote_presets where id = A;
  select count(*) into n from public.quote_temp_files where preset_id = A;
  perform t.ok('案件を消すと一時ファイルの行も消える', n = 0);
  perform t.err('画面（authenticated）からは掃除の関数を呼べない', 'set local role authenticated; select public.quote_temp_files_purge()', 'permission denied');
end $$;
SQL
echo "(後半 完了)"
