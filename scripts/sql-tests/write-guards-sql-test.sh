#!/usr/bin/env bash
# 書き込みの守り（docs/sql/write-guards.sql）を、使い捨ての PostgreSQL に「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   ①案件のロック・作成者を直接書き換えられない（関数からは変えられる）
#   ②「閲覧のみ」は書けない（読めはする）／不具合報告は書ける
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で  bash scripts/sql-tests/write-guards-sql-test.sh
#   ※ 本物の Supabase ではない。RLS・トリガー・冪等の論理を確かめるもの。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="writeguards_test_$$"
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
create function auth.email() returns text language sql stable as $f$ select auth.jwt() ->> 'email' $f$;
create table public.allowed_emails (email text primary key, role text);
create function public.is_team_member() returns boolean language sql security definer stable as
  $f$ select exists (select 1 from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email',''))) $f$;
create function public.get_my_role() returns text language sql security definer stable as
  $f$ select role from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email','')) $f$;
grant usage on schema auth, public to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant execute on function public.is_team_member(), public.get_my_role() to anon, authenticated;
insert into public.allowed_emails values ('admin@example.com','admin'), ('member@example.com','member'), ('viewer@example.com','viewer');
create extension if not exists pgcrypto;
alter default privileges in schema public grant all on tables to anon, authenticated;
-- Supabase Dashboard で作られている案件の表とポリシーの簡易な再現
create table public.quote_presets (id uuid primary key default gen_random_uuid(), name text, data jsonb, owner_email text, created_by text,
  locked_by text, locked_at timestamptz, force_released_from text, force_released_at timestamptz, updated_at timestamptz default now());
alter table public.quote_presets enable row level security;
create policy "team all" on public.quote_presets for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create table public.customer_rules (id uuid primary key default gen_random_uuid(), body text);
alter table public.customer_rules enable row level security;
create policy "team all" on public.customer_rules for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create table public.feedbacks (id uuid primary key default gen_random_uuid(), body text);
alter table public.feedbacks enable row level security;
create policy "anyone" on public.feedbacks for insert to authenticated with check (true);
insert into public.quote_presets (id, name, created_by) values ('11111111-1111-1111-1111-111111111111','Q1','member@example.com');
insert into public.customer_rules (body) values ('R1');
SQL
# 既存のロック関数・作成者の付け替え関数を入れてから、守りを 2 回流す（冪等）
sed -n '/^create or replace function public.quote_acquire_lock/,/^grant execute on function public.quote_admin_release_lock/p' "$ROOT/docs/supabase-schema.sql" > /tmp/wg_lock_$$.sql
$PSQL -f /tmp/wg_lock_$$.sql >/dev/null; rm -f /tmp/wg_lock_$$.sql
$PSQL -f "$ROOT/docs/sql/admin-edit-creator.sql" >/dev/null
for i in 1 2; do $PSQL -f "$ROOT/docs/sql/write-guards.sql" >/dev/null; done
ok; echo "PASS SQL を 2 回流してもエラーなし（冪等）"

as() { { $PSQL -At -c "set role $1; select set_config('request.jwt.claims', '{\"email\":\"$2\"}', false); $3" 2>&1 || true; } | tail -1; }
okq() { if grep -q 'ERROR'; then echo "ERR"; else echo "OK"; fi; }
err() { sed -E 's/^ERROR:  (permission denied|new row violates row-level security policy).*/\1/'; }
Q1="'11111111-1111-1111-1111-111111111111'"
row() { $PSQL -At -c "select coalesce(locked_by,'-')||'|'||coalesce(locked_at::text,'-')||'|'||coalesce(created_by,'-') from public.quote_presets where id=$Q1"; }

# ① ロック・作成者
as authenticated member@example.com "update public.quote_presets set locked_by='admin@example.com', locked_at='2099-01-01', name='Q1b' where id=$Q1" >/dev/null
check "① 直接ロックを書き込んでも元のまま（名前だけ変わる）" "-|-|member@example.com" "$(row)"
check "① 名前の更新はできる" "Q1b" "$($PSQL -At -c "select name from public.quote_presets where id=$Q1")"
as authenticated member@example.com "update public.quote_presets set created_by='mallory@example.com' where id=$Q1" >/dev/null
check "① 直接作成者を書き換えても元のまま" "member@example.com" "$($PSQL -At -c "select created_by from public.quote_presets where id=$Q1")"
check "① ロックの取得（関数）はできる" "OK" "$(as authenticated member@example.com "select public.quote_acquire_lock($Q1)")"
check "① 関数で取ったロックは入る" "member@example.com" "$($PSQL -At -c "select locked_by from public.quote_presets where id=$Q1")"
as authenticated member@example.com "update public.quote_presets set locked_by=null, locked_at=null where id=$Q1" >/dev/null
check "① 直接ロックを消すこともできない" "member@example.com" "$($PSQL -At -c "select locked_by from public.quote_presets where id=$Q1")"
check "① 他のメンバーは取得できない（保持者が返る）" "member@example.com" "$(as authenticated admin@example.com "select public.quote_acquire_lock($Q1)")"
check "① 管理者の強制解放（関数）はできる" "member@example.com" "$(as authenticated admin@example.com "select public.quote_admin_release_lock($Q1)")"
check "① 強制解放の印が入る" "-|member@example.com" "$($PSQL -At -c "select coalesce(locked_by,'-')||'|'||coalesce(force_released_from,'-') from public.quote_presets where id=$Q1")"
check "① 管理者の作成者の付け替え（関数）はできる" "OK" "$(as authenticated admin@example.com "select public.quote_admin_set_creator($Q1,'admin@example.com')")"
check "① 付け替えた作成者が入る" "admin@example.com" "$($PSQL -At -c "select created_by from public.quote_presets where id=$Q1")"
check "① 新しく作るとき、作成者は書いた本人・ロックは空" "member@example.com|-" "$(as authenticated member@example.com "insert into public.quote_presets (name, created_by, locked_by, locked_at) values ('Q2','admin@example.com','admin@example.com','2099-01-01') returning created_by||'|'||coalesce(locked_by,'-')")"

# ② 閲覧のみ
check "② 閲覧のみは案件を読める" "2" "$(as authenticated viewer@example.com "select count(*) from public.quote_presets")"
check "② 閲覧のみは案件を作れない" "new row violates row-level security policy" "$(as authenticated viewer@example.com "insert into public.quote_presets (name) values ('V')" | err)"
check "② 閲覧のみは案件を書き換えられない（0 行）" "0" "$(as authenticated viewer@example.com "with u as (update public.quote_presets set name='V' returning 1) select count(*) from u")"
check "② 閲覧のみは案件を消せない（0 行）" "0" "$(as authenticated viewer@example.com "with d as (delete from public.quote_presets returning 1) select count(*) from d")"
check "② 閲覧のみは取引ルールを作れない" "new row violates row-level security policy" "$(as authenticated viewer@example.com "insert into public.customer_rules (body) values ('V')" | err)"
check "② 閲覧のみは取引ルールを消せない（0 行）" "0" "$(as authenticated viewer@example.com "with d as (delete from public.customer_rules returning 1) select count(*) from d")"
check "② 閲覧のみはロックを取れない" "DENIED" "$(as authenticated viewer@example.com "select public.quote_acquire_lock($Q1)")"
check "② 閲覧のみでも不具合報告は送れる" "OK" "$(as authenticated viewer@example.com "insert into public.feedbacks (body) values ('bug')" | okq)"
check "② メンバーは取引ルールを作れる" "OK" "$(as authenticated member@example.com "insert into public.customer_rules (body) values ('M')" | okq)"
check "② メンバーは案件を書き換えられる（1 行）" "1" "$(as authenticated member@example.com "with u as (update public.quote_presets set name='M' where id=$Q1 returning 1) select count(*) from u")"
check "② メンバーでない人は案件を読めない" "0" "$(as authenticated mallory@example.com "select count(*) from public.quote_presets")"

echo "$PASS 項目 OK / $FAIL 件 NG"; [ "$FAIL" = 0 ]
