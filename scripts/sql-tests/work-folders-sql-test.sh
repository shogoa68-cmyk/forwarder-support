#!/usr/bin/env bash
# 作業フォルダの SQL（docs/sql/work-folders.sql ＋ work-folders-storage.sql）を、
# 使い捨ての PostgreSQL に「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で
#     bash scripts/sql-tests/work-folders-sql-test.sh
#   ※ 本物の Supabase ではない（認証・保存領域・メンバー判定を最小限に再現）。
#      RLS・列の権限・トリガー・関数の論理を確かめるもので、保存領域 API 自体の動作は確かめない。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="wf_test_$$"
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
create function auth.uid() returns uuid language sql stable as $f$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $f$;
create table public.allowed_emails (email text primary key);
create function public.is_team_member() returns boolean language sql security definer stable as
  $f$ select exists (select 1 from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email',''))) $f$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
grant execute on function public.is_team_member() to anon, authenticated, service_role;
insert into public.allowed_emails values ('alice@example.com'), ('bob@example.com');
SQL

# --- 本番のSQLを 2 回ずつ流す（何度流しても安全＝冪等であること）---
for i in 1 2; do
  $PSQL -f "$ROOT/docs/sql/work-folders.sql" >/dev/null
  $PSQL -f "$ROOT/docs/sql/work-folders-storage.sql" >/dev/null
done
echo "PASS SQL を 2 回流してもエラーなし（冪等）"

# --- 検証 ---
$PSQL <<'SQL'
create schema t;
create function t.as_user(p_email text, p_sub uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('email', p_email, 'sub', p_sub)::text, true);
  set local role authenticated;
end $f$;
create function t.ok(p_name text, p_cond boolean) returns void language plpgsql as $f$
begin
  if coalesce(p_cond, false) then raise notice 'PASS %', p_name; else raise exception 'FAIL %', p_name; end if;
end $f$;
-- 指定した SQL が、メッセージに p_like を含むエラーで失敗すること
create function t.err(p_name text, p_sql text, p_like text) returns void language plpgsql as $f$
declare m text;
begin
  begin
    execute p_sql;
  exception when others then
    m := sqlerrm;
  end;
  if m is null then raise exception 'FAIL %（エラーになるはずが成功した）', p_name; end if;
  -- p_like は「|」区切りで、どれか 1 つを含めば OK（例：'row-level security|permission denied'）
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
  a uuid := '00000000-0000-0000-0000-00000000000a';
  b uuid := '00000000-0000-0000-0000-00000000000b';
  folder_id uuid; f1 public.wf_nodes; f2 public.wf_nodes; f3 public.wf_nodes; liar public.wf_nodes; r public.wf_nodes;
  u record; n int; paths text[];
  MB bigint := 1048576;
begin
  -- ===== alice =====
  perform t.as_user('alice@example.com', a);
  insert into public.wf_nodes (parent_id, kind, name) values (null, 'folder', '見積資料') returning id into folder_id;
  perform t.ok('フォルダは画面（authenticated）から作れる', folder_id is not null);

  perform t.err('画面からファイルの行は直接作れない', $q$insert into public.wf_nodes (kind, name, size, storage_path) values ('file','x.pdf',1,'a/x')$q$, 'row-level security|permission denied');
  perform t.err('ファイルの行は、列の権限を通る形（parent_id・kind・name だけ）でも作れない', $q$insert into public.wf_nodes (kind, name) values ('file','y.pdf')$q$, 'row-level security|wf_file_has_source|violates');
  perform t.err('画面からは size を書き換えられない', $q$update public.wf_nodes set size = 1 where id = '$q$ || folder_id || $q$'$q$, 'permission denied');

  -- 予約
  f1 := public.wf_storage_reserve(folder_id, '見積書.pdf', 10 * MB, 'application/pdf');
  perform t.ok('予約すると pending の行ができ、保存場所は「ユーザー/行ID」', f1.upload_state = 'pending' and f1.storage_path = a::text || '/' || f1.id::text);
  perform t.err('同じ名前は予約できない', format($q$select public.wf_storage_reserve(%L, '見積書.pdf', 1, null)$q$, folder_id), '同じ名前');
  perform t.err('1 ファイルの上限（50MB）を超える予約は拒否', format($q$select public.wf_storage_reserve(%L, 'big.zip', %s, null)$q$, folder_id, 51 * MB), '上限は 50 MB');
  perform t.err('存在しない・他人のフォルダへの予約は拒否', $q$select public.wf_storage_reserve('00000000-0000-0000-0000-0000000000ff', 'x', 1, null)$q$, '保存先のフォルダ');
  perform t.err('名前に / は使えない', format($q$select public.wf_storage_reserve(%L, 'a/b.txt', 1, null)$q$, folder_id), 'ファイル名');

  -- 保存領域への書き込み（RLS）
  insert into storage.objects (bucket_id, name, owner, metadata) values ('work-folders', f1.storage_path, a, jsonb_build_object('size', 10 * MB, 'mimetype', 'application/pdf'));
  perform t.ok('予約済みの場所には書き込める', true);
  perform t.err('予約していない場所には書き込めない', $q$insert into storage.objects (bucket_id, name, owner, metadata) values ('work-folders', '00000000-0000-0000-0000-00000000000a/not-reserved', null, '{"size":1}')$q$, 'row-level security');
  perform t.err('別のバケットの扱いは対象外（予約があっても work-folders 以外は通らない）', format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('other', %L, null, '{"size":1}')$q$, f1.storage_path), 'row-level security');

  -- 確定
  r := public.wf_storage_finalize(f1.id);
  perform t.ok('確定すると ready になり、実際の大きさが入る', r.upload_state = 'ready' and r.size = 10 * MB);
  perform t.err('確定後は同じ場所へ上書き（再アップロード）できない', format($q$insert into storage.objects (bucket_id, name, owner, metadata) values ('work-folders', %L, null, '{"size":99}')$q$, f1.storage_path), 'duplicate key|row-level security');
  perform t.err('確定済みの行をもう一度確定はできない', format($q$select public.wf_storage_finalize(%L)$q$, f1.id), '予約が見つかりません');

  select * into u from public.wf_my_usage();
  perform t.ok('使用量は 10MB／上限 50MB／置き場は storage', u.used = 10 * MB and u.quota = 50 * MB and u.file_limit = 50 * MB and u.backend = 'storage');

  -- 容量
  perform t.err('上限を超える予約（10+45>50）は拒否', format($q$select public.wf_storage_reserve(%L, 'a.bin', %s, null)$q$, folder_id, 45 * MB), '容量の上限');
  f2 := public.wf_storage_reserve(folder_id, 'ぴったり.bin', 40 * MB, null);
  perform t.ok('ちょうど上限までの予約（10+40=50）は通る', f2.id is not null);
  perform t.err('予約中の分も数えるので、もう 1 バイトも予約できない', format($q$select public.wf_storage_reserve(%L, 'c.bin', 1, null)$q$, folder_id), '容量の上限');
  perform public.wf_storage_abort(f2.id);
  perform t.ok('取り消すと予約の行が消える', not exists (select 1 from public.wf_nodes where id = f2.id));

  -- 申告をごまかす：1 バイトと申告して実際は 45MB を置く → 確定で容量超過になり、後始末できる
  liar := public.wf_storage_reserve(folder_id, 'うそ.bin', 1, null);
  insert into storage.objects (bucket_id, name, owner, metadata) values ('work-folders', liar.storage_path, a, jsonb_build_object('size', 45 * MB));
  select * into u from public.wf_my_usage();
  perform t.ok('申告ではなく実際の大きさで数える（10+45=55MB）', u.used = 55 * MB);
  perform t.err('申告をごまかしたファイルは確定で拒否される', format($q$select public.wf_storage_finalize(%L)$q$, liar.id), '容量の上限');
  delete from storage.objects where bucket_id = 'work-folders' and name = liar.storage_path;
  perform public.wf_storage_abort(liar.id);
  select * into u from public.wf_my_usage();
  perform t.ok('後始末（ファイル削除→取り消し）で使用量は 10MB に戻る', u.used = 10 * MB);

  -- 中身が無いまま確定は拒否
  f3 := public.wf_storage_reserve(null, '空予約.txt', 5, null);
  perform t.err('ファイルを置かずに確定はできない', format($q$select public.wf_storage_finalize(%L)$q$, f3.id), '確認できません');
  perform public.wf_storage_abort(f3.id);

  -- 未完了が溜まりすぎ
  for n in 1..10 loop perform public.wf_storage_reserve(null, 'p' || n, 1, null); end loop;
  perform t.err('未完了が 10 件に達したら新しい予約は拒否', $q$select public.wf_storage_reserve(null, 'p11', 1, null)$q$, '未完了のアップロードが多すぎ');
  perform t.err('画面（authenticated）から行を直接削除はできない', $q$delete from public.wf_nodes where upload_state = 'pending'$q$, 'permission denied');
  -- 後片付け（正規の入口で）
  perform public.wf_storage_abort(id) from public.wf_nodes where upload_state = 'pending';

  -- フォルダの輪（自分の中へ移動）を拒否
  insert into public.wf_nodes (parent_id, kind, name) values (folder_id, 'folder', '中') ;
  perform t.err('フォルダを自分の子孫の中へは移せない', format($q$update public.wf_nodes set parent_id = (select id from public.wf_nodes where name = '中') where id = %L$q$, folder_id), '自分の中');

  -- ===== bob（別のメンバー）=====
  perform t.as_user('bob@example.com', b);
  perform t.ok('bob には alice のフォルダ・ファイルは見えない', (select count(*) from public.wf_nodes) = 0);
  perform t.ok('bob には alice の保存領域のファイルは見えない', (select count(*) from storage.objects) = 0);
  perform t.err('bob は alice のフォルダへ予約できない', format($q$select public.wf_storage_reserve(%L, 'b.txt', 1, null)$q$, folder_id), '保存先のフォルダ');
  perform t.err('bob は alice のファイルを確定・取り消しできない', format($q$select public.wf_storage_finalize(%L)$q$, f1.id), '見つかりません');
  delete from storage.objects where name = f1.storage_path;
  get diagnostics n = row_count;
  perform t.ok('bob は alice の保存領域のファイルを削除できない（0 件）', n = 0);
  n := public.wf_my_delete(array[folder_id]);
  perform t.ok('bob が alice のフォルダの完全削除を呼んでも 0 件（他人の行は消せない）', n = 0);

  -- ===== メンバーでない人 =====
  perform t.as_user('carol@example.com', gen_random_uuid());
  perform t.err('チームメンバーでない人は予約できない', $q$select public.wf_storage_reserve(null, 'c.txt', 1, null)$q$, 'ログインが必要');
  perform t.ok('チームメンバーでない人には何も見えない', (select count(*) from public.wf_nodes) = 0 and (select count(*) from public.wf_my_usage()) = 0);

  -- ===== 完全削除の入口（alice）=====
  perform t.as_user('alice@example.com', a);
  perform t.ok('bob の削除の試みは alice の行に影響していない', exists (select 1 from public.wf_nodes where id = folder_id));
  select array_agg(storage_path) into paths from public.wf_my_tree(array[folder_id]) where storage_path is not null;
  perform t.ok('フォルダの中のファイルの場所を調べられる', paths = array[f1.storage_path]);
  delete from storage.objects where bucket_id = 'work-folders' and name = any(paths);
  perform t.ok('自分のファイルは保存領域から削除できる', not exists (select 1 from storage.objects));
  n := public.wf_my_delete(array[folder_id]);
  perform t.ok('行を消すと中身の行も一緒に消える（子は cascade）', n = 1 and (select count(*) from public.wf_nodes) = 0);

  -- ===== 置き場の切り替え =====
  reset role;
  update public.wf_config set value = '"drive"'::jsonb where key = 'backend';
  perform t.as_user('alice@example.com', a);
  select * into u from public.wf_my_usage();
  perform t.ok('backend を drive にすると上限・置き場がドライブ用（5GB／2GB／drive）になる', u.backend = 'drive' and u.quota = 5368709120 and u.file_limit = 2147483648);
  reset role;
  update public.wf_config set value = '"storage"'::jsonb where key = 'backend';
end $$;
SQL
echo "--- 完了 ---"
