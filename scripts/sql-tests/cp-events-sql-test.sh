#!/usr/bin/env bash
# サイバーポート Webhook の保存先（docs/sql/cp-events.sql）を、使い捨ての PostgreSQL に
# 「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で
#     bash scripts/sql-tests/cp-events-sql-test.sh
#   ※ 本物の Supabase ではない（認証・メンバー判定・リアルタイムの公開設定を最小限に再現）。
#      RLS・権限・重複の無視・冪等の論理を確かめるもの。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="cpev_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
export PGDATABASE="$DB"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
ng()  { FAIL=$((FAIL+1)); echo "✗ NG: $1"; }
check() { # check "名前" "期待" "実際"
  if [ "$2" = "$3" ]; then ok; else ng "$1（期待=$2 実際=$3）"; fi
}

# --- Supabase の簡易な再現 ---
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
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function public.is_team_member() to anon, authenticated, service_role;
insert into public.allowed_emails values ('alice@example.com');
-- 本物の Supabase は、public の新しい表に anon / authenticated / service_role の全権限が最初から付く（既定の権限）。
-- これを再現しておく＝SQL 側の revoke（権限を外す処理）が実際に効いているかを確かめられる。
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
-- リアルタイムの公開設定（本物では最初からある）
create publication supabase_realtime;
SQL

# --- 本番のSQLを 2 回流す（何度流しても安全＝冪等であること）---
for i in 1 2; do $PSQL -f "$ROOT/docs/sql/cp-events.sql" >/dev/null; done
ok; echo "PASS SQL を 2 回流してもエラーなし（冪等）"

q() { $PSQL -At -c "$1" 2>&1 | head -1; }              # 管理者として
as() { # as <role> <email> <SQL>：その利用者として実行（Supabase の JWT の再現）
  $PSQL -At -c "set role $1; select set_config('request.jwt.claims', '{\"email\":\"$2\"}', false); $3" 2>&1 | tail -1
}

# 保存（service_role は RLS を通らず書ける）
$PSQL -c "set role service_role; insert into public.cp_events (dedupe_key, kind, history_id, payload) values ('h:1|o','report','1','{\"a\":1}');" >/dev/null
check "service_role は書ける（1 件入った）" "1" "$(q "select count(*) from public.cp_events")"

# 重複の無視（Edge Function の upsert … ignoreDuplicates と同じ動き）
$PSQL -c "set role service_role; insert into public.cp_events (dedupe_key, kind, payload) values ('h:1|o','report','{\"a\":2}') on conflict (dedupe_key) do nothing;" >/dev/null
check "同じ重複の印は 1 件のまま" "1" "$(q "select count(*) from public.cp_events")"
check "先に入った本文が残る（上書きされない）" "1" "$(q "select (payload->>'a') from public.cp_events where dedupe_key='h:1|o'")"
check "重複の印が違えば別の行" "2" "$($PSQL -At -c "set role service_role; insert into public.cp_events (dedupe_key, payload) values ('h:2|o','{}'); select count(*) from public.cp_events;" 2>&1 | tail -1)"

# 読み取り：チームメンバーだけ
check "メンバーは読める" "2" "$(as authenticated alice@example.com "select count(*) from public.cp_events")"
check "メンバーでないログイン済みの人は 0 件" "0" "$(as authenticated mallory@example.com "select count(*) from public.cp_events")"
check "メールの大文字小文字は区別しない" "2" "$(as authenticated ALICE@Example.com "select count(*) from public.cp_events")"
check "未ログイン(anon)は読めない（権限なし）" "permission denied" "$(as anon alice@example.com "select count(*) from public.cp_events" | sed -E 's/^ERROR:  (permission denied).*/\1/')"

# 書き込み：メンバーでも画面からはできない（Edge Function だけ）
for op in "insert into public.cp_events (dedupe_key, payload) values ('x','{}')" "update public.cp_events set kind='x'" "delete from public.cp_events"; do
  check "メンバーでも書けない: ${op%% (*}" "permission denied" "$(as authenticated alice@example.com "$op" | sed -E 's/^ERROR:  (permission denied).*/\1/')"
done
check "anon も書けない" "permission denied" "$(as anon alice@example.com "insert into public.cp_events (dedupe_key, payload) values ('y','{}')" | sed -E 's/^ERROR:  (permission denied).*/\1/')"
check "書き込みが拒否されたので件数は変わらない" "2" "$(q "select count(*) from public.cp_events")"

# 制約・リアルタイム・索引
check "payload は必須" "null value in column" "$($PSQL -At -c "set role service_role; insert into public.cp_events (dedupe_key) values ('z');" 2>&1 | head -1 | sed -E 's/^ERROR:  (null value in column).*/\1/')"
check "dedupe_key は必須" "null value in column" "$($PSQL -At -c "set role service_role; insert into public.cp_events (payload) values ('{}');" 2>&1 | head -1 | sed -E 's/^ERROR:  (null value in column).*/\1/')"
check "リアルタイムの公開に入っている" "1" "$(q "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='cp_events'")"
check "受信時刻の索引がある" "1" "$(q "select count(*) from pg_indexes where tablename='cp_events' and indexname='cp_events_received_idx'")"
check "received_at の既定は現在時刻" "t" "$(q "select received_at > now() - interval '1 minute' from public.cp_events limit 1")"
check "RLS が有効" "t" "$(q "select relrowsecurity from pg_class where relname='cp_events'")"
check "ポリシーは select の 1 つだけ" "1" "$(q "select count(*) from pg_policies where tablename='cp_events'")"

# リアルタイムの公開が無い環境（ローカルなど）でも、エラーにならない
dropdb "$DB"; createdb "$DB"
$PSQL -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end \$\$; create schema if not exists auth; create function auth.jwt() returns jsonb language sql stable as 'select null::jsonb'; create function public.is_team_member() returns boolean language sql stable as 'select false';" >/dev/null
if $PSQL -f "$ROOT/docs/sql/cp-events.sql" >/dev/null 2>&1; then ok; else ng "リアルタイムの公開が無い環境で失敗した"; fi

echo ""
echo "cp-events SQL 試験：${PASS} 件合格 / ${FAIL} 件失敗"
[ "$FAIL" = "0" ]
