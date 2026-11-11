#!/usr/bin/env bash
# マスターの変更履歴の SQL（docs/sql/master-history.sql）を、使い捨ての PostgreSQL に
# 「Supabase の仕組みの簡易な再現」と「マスター関連の表の代役」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で（スーパーユーザー）
#     bash scripts/sql-tests/master-history-sql-test.sh
#   ※ 本物の Supabase ではない（認証・メンバー判定を最小限に再現）。表は代役（キー列と更新日時のトリガーだけ本物に合わせた）。
#     履歴の記録・追記のみ・既存データの出発点・何度流しても安全、の論理を確かめるもの。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="mh_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
export PGDATABASE="$DB"

# --- Supabase の簡易な再現と、マスター関連の表の代役（alias_rules はわざと作らない＝無い環境で飛ばせるか確かめる）---
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
insert into public.allowed_emails values ('alice@example.com'), ('carol@example.com');

create table public.master_votes (id uuid primary key default gen_random_uuid(), field text not null, value text not null,
  voter_email text not null, created_at timestamptz default now(), unique (field, value, voter_email));
create table public.synonym_groups (id uuid primary key default gen_random_uuid(), field text not null, canonical text not null,
  aliases jsonb not null default '[]', created_by text, updated_by text, updated_at timestamptz default now(), unique (field, canonical));
create table public.master_details (id uuid primary key default gen_random_uuid(), field text not null, value text not null,
  details jsonb not null default '{}', created_by text, updated_by text, updated_at timestamptz default now(), unique (field, value));
create table public.master_requests (id uuid primary key default gen_random_uuid(), field text not null, value text not null,
  requested_by text not null, status text not null default 'pending', decided_by text);
create table public.master_attachments (id uuid primary key default gen_random_uuid(), field text not null, value text not null,
  storage_path text not null, file_name text not null, uploaded_by text);
create function public.touch_updated_at() returns trigger language plpgsql as $f$ begin new.updated_at = now(); return new; end $f$;
create trigger t_touch_sg before update on public.synonym_groups for each row execute function public.touch_updated_at();
create trigger t_touch_md before update on public.master_details for each row execute function public.touch_updated_at();
grant select, insert, update, delete on public.master_votes, public.synonym_groups, public.master_details,
  public.master_requests, public.master_attachments to authenticated, service_role;

-- 履歴の SQL を流す前から存在するデータ（出発点として記録されるはず）
insert into public.master_votes (field, value, voter_email) values ('customer','旧お客様A','alice@example.com'), ('sv','旧サブコンB','alice@example.com');
insert into public.synonym_groups (field, canonical, aliases) values ('customer','旧お客様A','["旧A","KyuA"]');
insert into public.master_details (field, value, details) values ('customer','旧お客様A','{"dealType":"ship"}');
SQL

# --- 本番の SQL を 2 回流す（何度流しても安全＝冪等であること）---
for i in 1 2; do $PSQL -f "$ROOT/docs/sql/master-history.sql" >/dev/null 2>&1; done
echo "PASS SQL を 2 回流してもエラーなし（冪等・表が無い alias_rules は飛ばす）"

# --- 検証 ---
$PSQL <<'SQL'
create schema t;
grant usage on schema t to public;
create function t.as_user(p_email text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('email', p_email)::text, true);
  set local role authenticated;
end $f$;
create function t.as_owner() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $f$;
create function t.ok(p_name text, p_cond boolean) returns void language plpgsql as $f$
begin
  if coalesce(p_cond, false) then raise notice 'PASS %', p_name; else raise exception 'FAIL %', p_name; end if;
end $f$;
-- 実行したらエラーになるはず、の確認（エラーの種類まで見る）
create function t.denied(p_name text, p_sql text, p_state text) returns void language plpgsql as $f$
declare s text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics s = returned_sqlstate;
    perform t.ok(p_name || '（' || s || '）', s = p_state);
    return;
  end;
  raise exception 'FAIL %（エラーになるはずが通った）', p_name;
end $f$;

do $$
declare n bigint; r record;
begin
  perform t.as_owner();

  -- A. 出発点（既存データ）
  perform t.ok('出発点：master_votes の既存 2 行', (select count(*) from master_history where source_table='master_votes' and action='BASELINE' and row_id is not null) = 2);
  perform t.ok('出発点：synonym_groups は代表名が value に入る', (select value from master_history where source_table='synonym_groups' and action='BASELINE' and row_id is not null) = '旧お客様A');
  perform t.ok('出発点：実行済みの目印が表ごとに 1 つ（5 表・alias_rules は無いので除く）', (select count(*) from master_history where action='BASELINE' and row_id is null) = 5);
  perform t.ok('出発点：2 回流しても二重に記録されない', (select count(*) from master_history where action='BASELINE') = 2+1+1 + 5);
  perform t.ok('トリガーが 5 つの表に付いた', (select count(*) from pg_trigger where tgname='trg_master_history') = 5);

  -- B. 追加（本人名義で記録）
  perform t.as_user('alice@example.com');
  insert into master_votes (field, value, voter_email) values ('customer','新お客様X','alice@example.com');
  select * into r from master_history where source_table='master_votes' and action='INSERT' order by id desc limit 1;
  perform t.ok('追加：誰が（ログイン中のメール）', r.changed_by = 'alice@example.com');
  perform t.ok('追加：何を（種別・名前）', r.field = 'customer' and r.value = '新お客様X');
  perform t.ok('追加：変更前は空・変更後に中身', r.old_data is null and r.new_data ->> 'voter_email' = 'alice@example.com');

  -- C. 変更（前後の中身が残る・実質変更なしは記録しない）
  select count(*) into n from master_history;
  update master_details set details = '{"dealType":"fwd"}' where value = '旧お客様A';
  select * into r from master_history where source_table='master_details' and action='UPDATE' order by id desc limit 1;
  perform t.ok('変更：変更前の中身が残る', r.old_data -> 'details' ->> 'dealType' = 'ship');
  perform t.ok('変更：変更後の中身が残る', r.new_data -> 'details' ->> 'dealType' = 'fwd');
  perform t.ok('変更：1 件だけ増えた', (select count(*) from master_history) = n + 1);
  update master_details set details = details where value = '旧お客様A';
  perform t.ok('変更なしの更新（更新日時だけ）は記録しない', (select count(*) from master_history) = n + 1);

  -- D. 削除（消した人と元の中身が残る）
  delete from master_votes where value = '新お客様X';
  select * into r from master_history where source_table='master_votes' and action='DELETE' order by id desc limit 1;
  perform t.ok('削除：誰が', r.changed_by = 'alice@example.com');
  perform t.ok('削除：元の中身が残る・変更後は空', r.old_data ->> 'value' = '新お客様X' and r.new_data is null);

  -- E. 別名・承認制・添付の表も記録される
  insert into synonym_groups (field, canonical, aliases) values ('sv','新サブコンY','["Y社"]');
  perform t.ok('別名グループ：代表名が value に入る', exists (select 1 from master_history where source_table='synonym_groups' and action='INSERT' and value='新サブコンY'));
  insert into master_requests (field, value, requested_by) values ('port','HOCHIMINH','carol@example.com');
  update master_requests set status='approved', decided_by='alice@example.com' where value='HOCHIMINH';
  perform t.ok('承認制：申請と承認の両方が記録される', (select count(*) from master_history where source_table='master_requests' and value='HOCHIMINH') = 2);
  insert into master_attachments (field, value, storage_path, file_name) values ('customer','旧お客様A','a/b','名刺.pdf');
  perform t.ok('添付：記録される', exists (select 1 from master_history where source_table='master_attachments' and value='旧お客様A'));

  -- F. 読めるのはチームメンバーだけ・アプリからは書けない
  perform t.ok('メンバーは履歴を読める', (select count(*) from master_history) > 0);
  perform t.denied('メンバーでも履歴に直接追加できない', $q$insert into master_history (source_table, action) values ('x','INSERT')$q$, '42501');
  perform t.denied('メンバーでも履歴を書き換えられない', $q$update master_history set changed_by = 'mallory'$q$, '42501');
  perform t.denied('メンバーでも履歴を消せない', $q$delete from master_history$q$, '42501');
  perform t.as_user('mallory@example.com');
  perform t.ok('メンバー以外には履歴が見えない', (select count(*) from master_history) = 0);

  -- G. 持ち主（スーパーユーザー）でも書き換え・削除・TRUNCATE は拒否
  perform t.as_owner();
  perform t.denied('持ち主でも履歴を書き換えられない', $q$update master_history set changed_by = 'x'$q$, '42501');
  perform t.denied('持ち主でも履歴を消せない', $q$delete from master_history$q$, '42501');
  perform t.denied('持ち主でも TRUNCATE できない', $q$truncate master_history$q$, '42501');

  -- H. DB から直接の操作（ログインなし）
  insert into master_votes (field, value, voter_email) values ('nm','直接追加','system@example.com');
  perform t.ok('ログインなしの操作は system: と記録される', (select changed_by from master_history where value='直接追加') like 'system:%');
end $$;
SQL
echo "ALL PASS"
