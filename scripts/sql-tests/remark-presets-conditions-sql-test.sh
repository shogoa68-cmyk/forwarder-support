#!/usr/bin/env bash
# リマークのプリセットの「条件」・使った記録（docs/sql/remark-presets-conditions.sql）を、使い捨ての PostgreSQL に
# 「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で  bash scripts/sql-tests/remark-presets-conditions-sql-test.sh
#   ※ 本物の Supabase ではない。RLS・権限・冪等の論理を確かめるもの。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="remark_cond_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
export PGDATABASE="$DB"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
ng()  { FAIL=$((FAIL+1)); echo "✗ NG: $1"; }
check() { if [ "$2" = "$3" ]; then ok; else ng "$1（期待=$2 実際=$3）"; fi; }

$PSQL <<'SQL'
create extension if not exists pgcrypto;
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
insert into public.allowed_emails values ('member@example.com','member');
-- Supabase と同じく、新しい表には標準で全権限が付く
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
SQL
# 既存の共有プリセットの表（docs/supabase-remark-presets-setup.sql＋貨物種別）
$PSQL -f "$ROOT/docs/supabase-remark-presets-setup.sql" >/dev/null
$PSQL -c "alter table public.remark_presets add column if not exists cargo_type text" >/dev/null

for i in 1 2; do $PSQL -f "$ROOT/docs/sql/remark-presets-conditions.sql" >/dev/null; done
ok; echo "PASS SQL を 2 回流してもエラーなし（冪等）"

as() { $PSQL -At -c "set role $1; select set_config('request.jwt.claims', '{\"email\":\"$2\"}', false); $3" 2>&1 | tail -1; }
okq() { if grep -q 'ERROR'; then echo "ERR"; else echo "OK"; fi; }
err() { sed -E 's/^ERROR:  (permission denied|new row violates row-level security policy|new row for relation "[a-z_]+" violates check constraint).*/\1/'; }

PID=$($PSQL -At -c "insert into public.remark_presets (label, text) values ('A','本文') returning id")
check "条件（オブジェクト）を保存できる" "OK" "$(as authenticated member@example.com "update public.remark_presets set conditions='{\"mode\":[\"fcl\"],\"cc\":[\"IN\"]}', en='Text' where id='$PID'" | okq)"
check "条件は保存した形で読める" "IN" "$(as authenticated member@example.com "select conditions->'cc'->>0 from public.remark_presets where id='$PID'")"
check "条件に配列は入れられない" "1" "$($PSQL -At -c "update public.remark_presets set conditions='[1]' where id='$PID'" 2>&1 | grep -c 'violates check constraint')"
check "メンバーは使った記録を足せる" "OK" "$(as authenticated member@example.com "insert into public.remark_preset_uses (preset_key, ctx) values ('s:$PID', '{\"mode\":\"fcl\"}')" | okq)"
check "押した人はサーバーが入れる（他人の名前を書いても自分になる）" "member@example.com" "$(as authenticated member@example.com "insert into public.remark_preset_uses (preset_key, ctx, used_by) values ('b:x', '{}', 'other@example.com'); select used_by from public.remark_preset_uses where preset_key='b:x'")"
check "日時もサーバーが入れる（過去の日時は書けない）" "t" "$(as authenticated member@example.com "insert into public.remark_preset_uses (preset_key, ctx, used_at) values ('b:y', '{}', '2000-01-01'); select used_at > now() - interval '1 minute' from public.remark_preset_uses where preset_key='b:y'")"
check "メンバーは記録を読める（3 件）" "3" "$(as authenticated member@example.com "select count(*) from public.remark_preset_uses")"
check "チームメンバーでない人は足せない" "new row violates row-level security policy" "$(as authenticated mallory@example.com "insert into public.remark_preset_uses (preset_key, ctx) values ('b:z','{}')" | err)"
check "チームメンバーでない人は読めない（0 件）" "0" "$(as authenticated mallory@example.com "select count(*) from public.remark_preset_uses")"
check "未ログイン(anon)は読めない" "permission denied" "$(as anon member@example.com "select count(*) from public.remark_preset_uses" | err)"
check "記録は書き換えられない" "permission denied" "$(as authenticated member@example.com "update public.remark_preset_uses set preset_key='b:q'" | err)"
check "記録は消せない" "permission denied" "$(as authenticated member@example.com "delete from public.remark_preset_uses" | err)"
check "条件の材料は 2000 文字まで" "1" "$(as authenticated member@example.com "insert into public.remark_preset_uses (preset_key, ctx) values ('b:big', jsonb_build_object('x', repeat('a', 2100)))" 2>&1 | grep -c 'violates check constraint')"
check "共有プリセットを消すと、その記録も消える（標準の定型文の記録は残る）" "2" "$(as authenticated member@example.com "delete from public.remark_presets where id='$PID'; select count(*) from public.remark_preset_uses")"
check "古い記録の掃除はメンバーから呼べない" "permission denied" "$(as authenticated member@example.com "select public.remark_preset_uses_purge()" | err)"

echo "$PASS 項目 OK / $FAIL 件 NG"; [ "$FAIL" = 0 ]
