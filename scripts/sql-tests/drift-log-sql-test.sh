#!/usr/bin/env bash
# ゆらぎチェックの記録（docs/sql/drift-log.sql）を、使い捨ての PostgreSQL に「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で  bash scripts/sql-tests/drift-log-sql-test.sh
#   ※ 本物の Supabase ではない。RLS・権限・冪等の論理を確かめるもの。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="drift_test_$$"
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
alter default privileges in schema public grant all on tables to anon, authenticated;
SQL

for i in 1 2; do $PSQL -f "$ROOT/docs/sql/drift-log.sql" >/dev/null; done
ok; echo "PASS SQL を 2 回流してもエラーなし（冪等）"

as() { $PSQL -At -c "set role $1; select set_config('request.jwt.claims', '{\"email\":\"$2\"}', false); $3" 2>&1 | tail -1; }
okq() { if grep -q 'ERROR'; then echo "ERR"; else echo "OK"; fi; }   # 成功すると何も表示されない（-q）ため、ERROR が無ければ OK
err() { sed -E 's/^ERROR:  (permission denied|new row violates row-level security policy).*/\1/'; }

check "管理者は『別名の登録』を記録できる" "OK" "$(as authenticated admin@example.com "insert into public.drift_log (kind,mode,field,alias,canonical) values ('alias','auto','customer','A','B')" | okq)"
check "管理者は実行記録を残せる" "OK" "$(as authenticated admin@example.com "insert into public.drift_log (kind) values ('run')" | okq)"
check "メンバーは『別物』を記録できる" "OK" "$(as authenticated member@example.com "insert into public.drift_log (kind,field,alias,canonical) values ('dismiss','customer','X','Y')" | okq)"
check "メンバーは『別名の登録』を記録できない" "new row violates row-level security policy" "$(as authenticated member@example.com "insert into public.drift_log (kind,field,alias,canonical) values ('alias','customer','X','Y')" | err)"
check "メンバーは実行記録を残せない" "new row violates row-level security policy" "$(as authenticated member@example.com "insert into public.drift_log (kind) values ('run')" | err)"
check "他人の名前では記録できない" "new row violates row-level security policy" "$(as authenticated admin@example.com "insert into public.drift_log (kind,by) values ('run','member@example.com')" | err)"
check "チームメンバーでない人は記録できない" "new row violates row-level security policy" "$(as authenticated mallory@example.com "insert into public.drift_log (kind) values ('dismiss')" | err)"
check "メンバーは全員の記録を読める（3 件）" "3" "$(as authenticated member@example.com "select count(*) from public.drift_log")"
check "メンバーでない人は 0 件" "0" "$(as authenticated mallory@example.com "select count(*) from public.drift_log")"
check "未ログイン(anon)は読めない" "permission denied" "$(as anon admin@example.com "select count(*) from public.drift_log" | err)"
check "更新できない（追記のみ）" "permission denied" "$(as authenticated admin@example.com "update public.drift_log set note='x'" | err)"
check "削除できない（追記のみ）" "permission denied" "$(as authenticated admin@example.com "delete from public.drift_log" | err)"
check "種類の値が不正なら拒否" "1" "$($PSQL -At -c "set role authenticated; select set_config('request.jwt.claims','{\"email\":\"admin@example.com\"}',false); insert into public.drift_log (kind) values ('bogus')" 2>&1 | grep -c 'violates check constraint')"

echo "$PASS 項目 OK / $FAIL 件 NG"; [ "$FAIL" = 0 ]
