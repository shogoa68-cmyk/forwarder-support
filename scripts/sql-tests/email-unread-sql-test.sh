#!/usr/bin/env bash
# メール取込「読み取れなかった行」の蓄積（docs/sql/email-import-unread.sql）を、使い捨ての PostgreSQL に
# 「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で  bash scripts/sql-tests/email-unread-sql-test.sh
#   ※ 本物の Supabase ではない。RLS・権限・伏せ字の強制・冪等の論理を確かめるもの。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="unread_test_$$"
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

for i in 1 2; do $PSQL -f "$ROOT/docs/sql/email-import-unread.sql" >/dev/null; done
ok; echo "PASS SQL を 2 回流してもエラーなし（冪等）"

as() { $PSQL -At -c "set role $1; select set_config('request.jwt.claims', '{\"email\":\"$2\"}', false); $3" 2>&1 | tail -1; }
err() { sed -E 's/^ERROR:  (permission denied|new row violates row-level security policy).*/\1/'; }
rec() { as authenticated "$1" "select public.email_unread_record(array[$2])"; }

check "メンバーは伏せた形を記録できる（2 件）" "2" "$(rec member@example.com "'定温庫保管料：\\999/M9/期','ショートドレー99F：\\99,999/VAN'")"
check "同じ形をもう一度記録すると、行は増えず回数だけ増える" "1" "$(as authenticated member@example.com "select count(*) from public.email_import_unread where shape like '定温庫保管料%'")"
rec member@example.com "'定温庫保管料：\\999/M9/期'" >/dev/null
check "同じ形を 2 回記録すると回数は 2" "2" "$(as authenticated member@example.com "select seen_count from public.email_import_unread where shape like '定温庫保管料%'")"
check "伏せていない行（数字 0〜8 を含む）は受け付けない" "0" "$(rec member@example.com "'定温庫保管料：\\850/M9/期'")"
check "全角の数字も、9 以外は受け付けない" "0" "$(rec member@example.com "'保管料：￥８５０'")"
check "全角の 9 は受け付ける" "1" "$(rec member@example.com "'保管料：￥９９９'")"
check "メールアドレスを含む行は受け付けない" "0" "$(rec member@example.com "'連絡先 taro@example.com 999'")"
check "URL を含む行は受け付けない" "0" "$(rec member@example.com "'見積 https://example.com/x 999'")"
check "短すぎる行・長すぎる行は受け付けない" "0" "$(rec member@example.com "'99', '$(printf 'あ%.0s' $(seq 1 170))'")"
check "1 回に記録できるのは 20 件まで" "20" "$(rec member@example.com "$(for i in $(seq 1 30); do printf "'項目%s 999'," "$(printf 'x%.0s' $(seq 1 $i))"; done | sed 's/,$//')")"
check "チームメンバーでない人は記録できない（0 件）" "0" "$(rec mallory@example.com "'保管料：\\999'")"
check "未ログイン(anon)は呼べない" "permission denied" "$(as anon member@example.com "select public.email_unread_record(array['保管料 999'])" | err)"
check "表を直接書き込めない（insert）" "permission denied" "$(as authenticated member@example.com "insert into public.email_import_unread (shape) values ('x 999')" | err)"
check "表を直接削除できない" "permission denied" "$(as authenticated admin@example.com "delete from public.email_import_unread" | err)"
check "メンバーは全員の記録を読める" "OK" "$([ "$(as authenticated member@example.com "select count(*) from public.email_import_unread")" -gt 0 ] && echo OK)"
check "メンバーでない人は 0 件" "0" "$(as authenticated mallory@example.com "select count(*) from public.email_import_unread")"
check "未ログイン(anon)は読めない" "permission denied" "$(as anon x@example.com "select count(*) from public.email_import_unread" | err)"
check "管理者は対応状況（status・note）を更新できる" "handled" "$(as authenticated admin@example.com "update public.email_import_unread set status='handled', note='円記号\\対応' where shape like '定温庫保管料%' returning status" | head -1)"
check "メンバーは対応状況を更新できない（0 行）" "0" "$(as authenticated member@example.com "with u as (update public.email_import_unread set status='ignored' returning 1) select count(*) from u")"
check "shape（読めなかった形）は管理者でも書き換えられない" "permission denied" "$(as authenticated admin@example.com "update public.email_import_unread set shape='別の形 999'" | err)"
check "状態の値が不正なら拒否" "1" "$($PSQL -At -c "set role authenticated; select set_config('request.jwt.claims','{\"email\":\"admin@example.com\"}',false); update public.email_import_unread set status='bogus'" 2>&1 | grep -c 'violates check constraint')"
rec member@example.com "'定温庫保管料：\\999/M9/期'" >/dev/null
check "対応済みの形がまた出たら「新規」に戻る" "new" "$(as authenticated member@example.com "select status from public.email_import_unread where shape like '定温庫保管料%'")"

echo "$PASS 項目 OK / $FAIL 件 NG"; [ "$FAIL" = 0 ]
