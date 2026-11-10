#!/usr/bin/env bash
# 動静の自動確認の SQL（docs/sql/cp-watch.sql）を、使い捨ての PostgreSQL に
# 「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で（スーパーユーザー）
#     bash scripts/sql-tests/cp-watch-sql-test.sh
#   ※ 本物の Supabase ではない（認証・メンバー判定を最小限に再現）。RLS・列の権限・選び方の論理を確かめるもの。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="cpw_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
export PGDATABASE="$DB"

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
create table public.quote_presets (id uuid primary key default gen_random_uuid(), name text, status text);
grant usage on schema auth, public to anon, authenticated, service_role;
grant select on public.quote_presets to authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function public.is_team_member() to anon, authenticated, service_role;
insert into public.allowed_emails values ('alice@example.com');
SQL

# --- 本番の SQL を 2 回流す（何度流しても安全＝冪等であること）---
for i in 1 2; do $PSQL -f "$ROOT/docs/sql/cp-watch.sql" >/dev/null; done
echo "PASS SQL を 2 回流してもエラーなし（冪等）"

# --- 検証 ---
$PSQL <<'SQL'
create schema t;
create function t.as_user(p_email text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('email', p_email)::text, true);
  set local role authenticated;
end $f$;
create function t.as_service() returns void language plpgsql as $f$
begin
  reset role;
  set local role service_role;
end $f$;
create function t.as_admin() returns void language plpgsql as $f$
begin
  reset role;
end $f$;
create function t.ok(p_name text, p_cond boolean) returns void language plpgsql as $f$
begin
  if coalesce(p_cond, false) then raise notice 'PASS %', p_name; else raise exception 'FAIL %', p_name; end if;
end $f$;
-- 指定した SQL が、メッセージに p_like（「|」区切りのどれか）を含むエラーで失敗すること
create function t.err(p_name text, p_sql text, p_like text) returns void language plpgsql as $f$
declare m text;
begin
  begin
    execute p_sql;
  exception when others then
    m := sqlerrm;
  end;
  if m is null then raise exception 'FAIL %（エラーになるはずが成功した）', p_name; end if;
  if not exists (select 1 from unnest(string_to_array(p_like, '|')) k where m like '%' || k || '%') then
    raise exception 'FAIL %（別のエラー：%）', p_name, m;
  end if;
  raise notice 'PASS %', p_name;
end $f$;
grant usage on schema t to authenticated, service_role, anon;
grant execute on all functions in schema t to authenticated, service_role, anon;
SQL

$PSQL <<'SQL' 2>&1 | sed -n 's/^psql:.*NOTICE:  //p; s/^NOTICE:  //p; /ERROR/p; /DETAIL/p; /CONTEXT/p'
do $$
declare
  A  constant uuid := '00000000-0000-0000-0000-000000000001';
  B  constant uuid := '00000000-0000-0000-0000-000000000002';
  C  constant uuid := '00000000-0000-0000-0000-000000000003';
  D  constant uuid := '00000000-0000-0000-0000-000000000004';
  E  constant uuid := '00000000-0000-0000-0000-000000000005';
  F  constant uuid := '00000000-0000-0000-0000-000000000006';
  G  constant uuid := '00000000-0000-0000-0000-000000000007';
  H  constant uuid := '00000000-0000-0000-0000-000000000008';
  J  constant uuid := '00000000-0000-0000-0000-00000000000a';
  ids uuid[];
begin
  -- 案件（受注の A・B・C・D(won)・F・G・H と、下書きの E）と名簿
  insert into public.quote_presets (id, name, status) values
    (A, 'A 受注・未確認', '受注'), (B, 'B 受注・期限近い', '受注'), (C, 'C 受注・最近確認済み', '受注'), (D, 'D 受注・古く確認', 'won'),
    (E, 'E 下書き（対象外）', '下書き中'), (F, 'F 受注・3回失敗中', '受注'), (G, 'G 受注・追跡しない', '受注'), (H, 'H 受注・追跡完了', '受注'),
    (J, 'J 追加テスト用', '受注');
  insert into public.cp_watch_targets (preset_id, direction, bl_no, trace, state, last_checked_at, urgent_at, consecutive_errors) values
    (A, 'import', 'BL1', true,  'active', null,                          null,                        0),
    (B, 'import', 'BL2', true,  'active', now() - interval '5 hours',    now() + interval '10 hours', 0),
    (C, 'export', 'BK3', true,  'active', now() - interval '30 minutes', null,                        0),
    (D, 'export', 'BK4', true,  'active', now() - interval '20 hours',   null,                        0),
    (E, 'export', 'BK5', true,  'active', null,                          null,                        0),
    (F, 'import', 'BL6', true,  'active', now() - interval '3 hours',    null,                        3),
    (G, 'import', 'BL7', false, 'active', null,                          null,                        0),
    (H, 'import', 'BL8', true,  'done',   null,                          null,                        0);

  -- ① 選び方（service_role）
  perform t.as_service();
  select array_agg(preset_id order by preset_id) into ids from public.cp_watch_pick(10);
  perform t.ok('選ばれるのは 受注＋追跡中＋追跡中の状態＋最近確認していない案件（A・B・D）', ids = array[A, B, D]);
  select array_agg(preset_id) into ids from public.cp_watch_pick(10);
  perform t.ok('順番：期限が近い B → 未確認の A → 古く確認の D', ids = array[B, A, D]);
  perform t.ok('下書き（E）・追跡しない（G）・追跡完了（H）・最近確認した（C）は選ばない',
    not exists (select 1 from public.cp_watch_pick(10) where preset_id in (C, E, G, H)));
  perform t.ok('3 回続けて失敗（F）は 6 時間あけるまで選ばない（3 時間前に確認）', not exists (select 1 from public.cp_watch_pick(10) where preset_id = F));
  perform t.ok('件数の指定（2 件）', (select count(*) from public.cp_watch_pick(2)) = 2);
  perform t.ok('件数の指定が 0 以下でも 1 件は選ぶ（下限）', (select count(*) from public.cp_watch_pick(0)) = 1);
  perform t.ok('確認の間隔を 10 分にすると、最近確認した C も対象になる', exists (select 1 from public.cp_watch_pick(10, interval '10 minutes') where preset_id = C));
  perform t.as_admin();
  update public.cp_watch_targets set last_checked_at = now() - interval '7 hours' where preset_id = F;
  perform t.as_service();
  perform t.ok('3 回失敗でも 6 時間たてば選ばれる（F）', exists (select 1 from public.cp_watch_pick(10) where preset_id = F));

  -- ② 権限：画面（チームメンバー）は名簿を読み書きできるが、結果の列は書けない・関数は呼べない
  perform t.as_user('alice@example.com');
  perform t.ok('メンバーは名簿を読める', (select count(*) from public.cp_watch_targets) = 8);
  insert into public.cp_watch_targets (preset_id, direction, bl_no, created_by) values (J, 'import', 'BLJ', 'alice@example.com');
  perform t.ok('メンバーは名簿に追加できる（追跡の開始）', exists (select 1 from public.cp_watch_targets where preset_id = J));
  update public.cp_watch_targets set trace = false, updated_by = 'alice@example.com' where preset_id = J;
  perform t.ok('メンバーは追跡の入り切りができる', (select trace from public.cp_watch_targets where preset_id = J) = false);
  update public.cp_watch_targets set ask_snooze_until = now() + interval '3 days', state = 'active' where preset_id = J;
  perform t.ok('メンバーは「もう少し追う」（確認の知らせを止める）を設定できる', (select ask_snooze_until from public.cp_watch_targets where preset_id = J) is not null);
  perform t.err('メンバーは前回の写し（snapshot）を書き換えられない', format($q$update public.cp_watch_targets set snapshot = '[]'::jsonb where preset_id = %L$q$, J), 'permission denied');
  perform t.err('メンバーは最後に確認した時刻を偽れない', format($q$update public.cp_watch_targets set last_checked_at = now() where preset_id = %L$q$, J), 'permission denied');
  perform t.err('メンバーは連続失敗の回数を書き換えられない', format($q$update public.cp_watch_targets set consecutive_errors = 0 where preset_id = %L$q$, J), 'permission denied');
  perform t.err('メンバーは優先の目安（urgent_at）を書き換えられない', format($q$update public.cp_watch_targets set urgent_at = now() where preset_id = %L$q$, J), 'permission denied');
  perform t.err('メンバーは追加のときも結果の列（snapshot）を入れられない', format($q$insert into public.cp_watch_targets (preset_id, direction, snapshot) values (%L, 'import', '[]'::jsonb)$q$, G), 'permission denied');
  perform t.err('メンバーは変化の記録を書けない', format($q$insert into public.cp_changes (preset_id, scope, label, kind, sev) values (%L, 's', 'l', 'new', 'info')$q$, A), 'permission denied');
  perform t.err('メンバーは実行記録を書けない', $q$insert into public.cp_watch_runs (picked) values (1)$q$, 'permission denied');
  perform t.err('メンバーは選ぶ関数を直接呼べない', $q$select * from public.cp_watch_pick(5)$q$, 'permission denied');
  perform t.err('メンバーは掃除の関数を呼べない', $q$select public.cp_watch_purge()$q$, 'permission denied');
  perform t.err('向きは輸入・輸出以外を入れられない', format($q$update public.cp_watch_targets set direction = 'air' where preset_id = %L$q$, J), 'check constraint');
  perform t.err('状態は決まった値だけ', format($q$update public.cp_watch_targets set state = 'zzz' where preset_id = %L$q$, J), 'check constraint');
  delete from public.cp_watch_targets where preset_id = J;
  perform t.ok('メンバーは名簿から外せる', not exists (select 1 from public.cp_watch_targets where preset_id = J));

  -- メンバーでない人は何も見えない・書けない
  perform t.as_user('mallory@example.com');
  perform t.ok('メンバーでない人には名簿が見えない', (select count(*) from public.cp_watch_targets) = 0);
  perform t.err('メンバーでない人は追加できない', format($q$insert into public.cp_watch_targets (preset_id, direction) values (%L, 'import')$q$, J), 'row-level security');
  delete from public.cp_watch_targets;
  perform t.as_admin();
  perform t.ok('メンバーでない人の操作で名簿は減っていない', (select count(*) from public.cp_watch_targets) = 8);

  -- ③ 変化・実行記録は service_role が書き、メンバーは読める
  perform t.as_service();
  insert into public.cp_watch_runs (picked, ok) values (3, 3);
  insert into public.cp_changes (preset_id, run_id, scope, label, old_val, new_val, kind, sev, note)
    values (A, 1, '本船 X 1E', '入港 予定(ETA)', '2026-11-10T00:00:00Z', '2026-11-12T00:00:00Z', 'changed', 'warn', '＋2日');
  perform t.err('変化の種類は決まった値だけ', format($q$insert into public.cp_changes (preset_id, scope, label, kind, sev) values (%L, 's', 'l', 'zzz', 'info')$q$, A), 'check constraint');
  perform t.err('重みは決まった値だけ', format($q$insert into public.cp_changes (preset_id, scope, label, kind, sev) values (%L, 's', 'l', 'new', 'zzz')$q$, A), 'check constraint');
  perform t.as_user('alice@example.com');
  perform t.ok('メンバーは変化の記録を読める', (select count(*) from public.cp_changes) = 1);
  perform t.ok('メンバーは実行記録を読める', (select count(*) from public.cp_watch_runs) = 1);
  perform t.as_user('mallory@example.com');
  perform t.ok('メンバーでない人には変化の記録・実行記録が見えない', (select count(*) from public.cp_changes) = 0 and (select count(*) from public.cp_watch_runs) = 0);

  -- ④ 案件を消すと、名簿も変化も一緒に消える
  perform t.as_admin();
  delete from public.quote_presets where id = A;
  perform t.ok('案件を消すと名簿・変化の記録も消える', not exists (select 1 from public.cp_watch_targets where preset_id = A) and not exists (select 1 from public.cp_changes where preset_id = A));

  -- ⑤ 掃除
  insert into public.cp_changes (preset_id, scope, label, kind, sev, detected_at) values (B, 's', 'old', 'new', 'info', now() - interval '100 days');
  insert into public.cp_watch_runs (picked, started_at) values (1, now() - interval '40 days');
  perform t.as_service();
  perform public.cp_watch_purge();
  perform t.as_admin();
  perform t.ok('掃除：90 日より古い変化と 30 日より古い実行記録が消える', not exists (select 1 from public.cp_changes where label = 'old') and not exists (select 1 from public.cp_watch_runs where started_at < now() - interval '30 days'));
  perform t.ok('掃除：新しい記録は残る', (select count(*) from public.cp_watch_runs) = 1);
end $$;
SQL
echo "ALL DONE"
