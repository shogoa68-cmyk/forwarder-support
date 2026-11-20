#!/usr/bin/env bash
# 進行管理の表（docs/sql/ops-jobs.sql）を、使い捨ての PostgreSQL に「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で  bash scripts/sql-tests/ops-jobs-sql-test.sh
#   ※ 本物の Supabase ではない。RLS・権限・冪等の論理を確かめるもの。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="opsjobs_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
export PGDATABASE="$DB"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
ng()  { FAIL=$((FAIL+1)); echo "✗ NG: $1"; }
check() { if [ "$2" = "$3" ]; then ok; else ng "$1（期待=$2 実際=$3）"; fi; }

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
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant execute on function public.is_team_member(), public.get_my_role() to anon, authenticated;
insert into public.allowed_emails values ('admin@example.com','admin'), ('member@example.com','member');
create extension if not exists pgcrypto;
create table public.quote_presets (id uuid primary key default gen_random_uuid(), name text);
insert into public.quote_presets (id, name) values ('11111111-1111-1111-1111-111111111111','Q1'), ('22222222-2222-2222-2222-222222222222','Q2');
alter default privileges in schema public grant all on tables to anon, authenticated;
SQL

for i in 1 2; do $PSQL -f "$ROOT/docs/sql/ops-jobs.sql" >/dev/null; done
ok; echo "PASS SQL を 2 回流してもエラーなし（冪等）"

as() { $PSQL -At -c "set role $1; select set_config('request.jwt.claims', '{\"email\":\"$2\"}', false); $3" 2>&1 | tail -1; }
okq() { if grep -q 'ERROR'; then echo "ERR"; else echo "OK"; fi; }
err() { sed -E 's/^ERROR:  (permission denied|new row violates row-level security policy|duplicate key value|new row for relation "ops_jobs" violates check constraint).*/\1/'; }

check "メンバーはスポットの進行を作れる" "OK" "$(as authenticated member@example.com "insert into public.ops_jobs (kind,title,customer,data) values ('spot','A社 スポット','A社','{\"charges\":[]}')" | okq)"
check "メンバーはレギュラーの進行を作れる" "OK" "$(as authenticated member@example.com "insert into public.ops_jobs (kind,title,preset_id) values ('regular','B社 毎月便','11111111-1111-1111-1111-111111111111')" | okq)"
check "作成者はサーバーが決める（他人の名前を書いても自分）" "member@example.com" "$(as authenticated member@example.com "insert into public.ops_jobs (kind,title,created_by) values ('spot','C','admin@example.com') returning created_by")"
check "名前が空なら拒否" "new row for relation \"ops_jobs\" violates check constraint" "$(as authenticated member@example.com "insert into public.ops_jobs (kind,title) values ('spot','  ')" | err)"
check "種類の値が不正なら拒否" "new row for relation \"ops_jobs\" violates check constraint" "$(as authenticated member@example.com "insert into public.ops_jobs (kind,title) values ('bogus','x')" | err)"
check "同じ見積に 2 つの進行は紐づけられない" "duplicate key value" "$(as authenticated admin@example.com "insert into public.ops_jobs (kind,title,preset_id) values ('spot','D','11111111-1111-1111-1111-111111111111')" | err)"
check "メンバーは読める（3 件）" "3" "$(as authenticated member@example.com "select count(*) from public.ops_jobs")"
check "メンバーでない人は 0 件" "0" "$(as authenticated mallory@example.com "select count(*) from public.ops_jobs")"
check "メンバーでない人は作れない" "new row violates row-level security policy" "$(as authenticated mallory@example.com "insert into public.ops_jobs (kind,title) values ('spot','x')" | err)"
check "未ログイン(anon)は読めない" "permission denied" "$(as anon admin@example.com "select count(*) from public.ops_jobs" | err)"
check "ほかのメンバーが作った進行も更新できる（チームで共有）" "admin@example.com" "$(as authenticated admin@example.com "update public.ops_jobs set status='done' where title='A社 スポット' returning updated_by")"
check "更新しても作成者は変わらない" "member@example.com" "$(as authenticated admin@example.com "update public.ops_jobs set created_by='admin@example.com' where title='A社 スポット' returning created_by")"
check "メンバーでない人は更新できない（0 行）" "0" "$(as authenticated mallory@example.com "with u as (update public.ops_jobs set title='x' returning 1) select count(*) from u")"
$PSQL -c "delete from public.quote_presets where id='11111111-1111-1111-1111-111111111111'"
check "見積を消すと紐付けだけ外れ、進行は残る" "|B社 毎月便" "$($PSQL -At -c "select coalesce(preset_id::text,'')||'|'||title from public.ops_jobs where kind='regular'")"
check "メンバーは削除できる" "1" "$(as authenticated member@example.com "with d as (delete from public.ops_jobs where title='C' returning 1) select count(*) from d")"

echo "$PASS 項目 OK / $FAIL 件 NG"; [ "$FAIL" = 0 ]
