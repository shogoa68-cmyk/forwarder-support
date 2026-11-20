#!/usr/bin/env bash
# 作業カードの表（docs/sql/ops-cards.sql）を、使い捨ての PostgreSQL に「Supabase の仕組みの簡易な再現」を作って流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で  bash scripts/sql-tests/ops-cards-sql-test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="opscards_test_$$"
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
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant execute on function public.is_team_member() to anon, authenticated;
insert into public.allowed_emails values ('admin@example.com','admin'), ('member@example.com','member');
alter default privileges in schema public grant all on tables to anon, authenticated;
SQL

for i in 1 2; do $PSQL -f "$ROOT/docs/sql/ops-cards.sql" >/dev/null; done
ok; echo "PASS SQL を 2 回流してもエラーなし（冪等）"

as() { $PSQL -At -c "set role $1; select set_config('request.jwt.claims', '{\"email\":\"$2\"}', false); $3" 2>&1 | tail -1; }
okq() { if grep -q 'ERROR'; then echo "ERR"; else echo "OK"; fi; }
err() { sed -E 's/^ERROR:  (permission denied|new row violates row-level security policy|duplicate key value|new row for relation "ops_[a-z]+" violates check constraint).*/\1/'; }

# 手順メモ
check "メンバーは手順メモを書ける" "OK" "$(as authenticated member@example.com "insert into public.ops_guides (key,label,body) values ('si（船積指示）の提出','SI（船積指示）の提出','1. 船会社のサイトで提出')" | okq)"
check "更新者はサーバーが決める（他人の名前を書いても自分）" "member@example.com" "$(as authenticated member@example.com "update public.ops_guides set body='2. 確認', updated_by='admin@example.com' returning updated_by")"
check "ほかのメンバーも直せる（チームで共有）" "admin@example.com" "$(as authenticated admin@example.com "update public.ops_guides set body='3. 直した' returning updated_by")"
check "同じ key は 2 つ作れない（upsert で直す）" "duplicate key value" "$(as authenticated admin@example.com "insert into public.ops_guides (key,body) values ('si（船積指示）の提出','x')" | err)"
check "upsert で直せる" "OK" "$(as authenticated admin@example.com "insert into public.ops_guides (key,body) values ('si（船積指示）の提出','x') on conflict (key) do update set body=excluded.body" | okq)"
check "メンバーでない人は 0 件" "0" "$(as authenticated mallory@example.com "select count(*) from public.ops_guides")"
check "メンバーでない人は書けない" "new row violates row-level security policy" "$(as authenticated mallory@example.com "insert into public.ops_guides (key,body) values ('a','b')" | err)"
check "未ログイン(anon)は読めない" "permission denied" "$(as anon admin@example.com "select count(*) from public.ops_guides" | err)"
check "長すぎる手順は拒否" "new row for relation \"ops_guides\" violates check constraint" "$(as authenticated admin@example.com "insert into public.ops_guides (key,body) values ('long', repeat('a',4001))" | err)"

# やりとり
check "メンバーは記録を書ける" "OK" "$(as authenticated member@example.com "insert into public.ops_notes (target,step_id,body) values ('q:abc','s1','INV を受け取りました')" | okq)"
check "書いた人はサーバーが決める（他人の名前では書けない）" "member@example.com" "$(as authenticated member@example.com "insert into public.ops_notes (target,step_id,body,created_by) values ('q:abc','s1','2','admin@example.com') returning created_by")"
check "空の記録は拒否" "new row for relation \"ops_notes\" violates check constraint" "$(as authenticated member@example.com "insert into public.ops_notes (target,step_id,body) values ('q:abc','s1','   ')" | err)"
check "ほかのメンバーも読める（2 件）" "2" "$(as authenticated admin@example.com "select count(*) from public.ops_notes where target='q:abc'")"
check "記録は直せない" "permission denied" "$(as authenticated member@example.com "update public.ops_notes set body='x'" | err)"
check "ほかの人の記録は消せない（0 行）" "0" "$(as authenticated admin@example.com "with d as (delete from public.ops_notes returning 1) select count(*) from d")"
check "書いた本人は消せる" "2" "$(as authenticated member@example.com "with d as (delete from public.ops_notes returning 1) select count(*) from d")"
check "メンバーでない人は書けない" "new row violates row-level security policy" "$(as authenticated mallory@example.com "insert into public.ops_notes (target,step_id,body) values ('q:abc','s1','x')" | err)"
check "未ログイン(anon)は読めない" "permission denied" "$(as anon admin@example.com "select count(*) from public.ops_notes" | err)"

echo "$PASS 項目 OK / $FAIL 件 NG"; [ "$FAIL" = 0 ]
