-- ============================================================
-- 📁 作業フォルダ（ユーザーごとの個人フォルダ）…共通の土台
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：is_team_member() 関数（チーム共有の本体 SQL 適用済み）
--
-- ファイルの中身の置き場は 2 通り（設定 backend で切り替え。どちらも画面は同じ）
--   ・storage … Supabase の保存領域（標準。追加の設定なし）→ このあと docs/sql/work-folders-storage.sql も実行
--   ・drive   … 管理者の Google ドライブ（Edge Function `workfolder`。大きい容量が要るとき）
--
-- しくみ（やさしく言うと）
--   ・「どのフォルダにどのファイルがあるか」という整理の情報は、この表（wf_nodes）で持つ。
--     だから名前の変更・移動・ゴミ箱は、この表を書き換えるだけで一瞬で終わる。
--   ・自分の行しか見えない（他のメンバーのファイルは見えない・共有なし）。
--   ・ファイル行の追加・完全削除は、画面から直接はできない（サーバー側の決まった入口だけ）。
--     画面から勝手に「大きさ 0」や他人のファイルの場所を書いて、容量制限をすり抜けられないように。
-- ============================================================

-- 1) 設定表（容量の上限・ドライブの保存先フォルダ ID）。画面からは読めない（RLS で全拒否）
create table if not exists public.wf_config (
  key   text primary key,
  value jsonb not null
);
alter table public.wf_config enable row level security;
revoke all on public.wf_config from anon, authenticated;
-- どちらの置き場を使うか（'storage' | 'drive'）。切り替えるときはこの値だけ書き換える：
--   update public.wf_config set value = '"drive"'::jsonb where key = 'backend';
-- 1 人あたりの上限と 1 ファイルの上限（置き場ごと。変えるときはこの値だけ書き換える）
insert into public.wf_config (key, value) values
  ('backend',             '"storage"'::jsonb),
  ('quota_bytes_storage', to_jsonb(52428800::bigint)),      -- 50MB（Free プランの保存領域は全体で 1GB なので小さめ）
  ('file_limit_storage',  to_jsonb(52428800::bigint)),      -- 50MB（Free プランの 1 ファイル上限）
  ('quota_bytes_drive',   to_jsonb(5368709120::bigint)),    -- 5GB
  ('file_limit_drive',    to_jsonb(2147483648::bigint))     -- 2GB
on conflict (key) do nothing;

-- 2) フォルダ／ファイルの表 ------------------------------------------
create table if not exists public.wf_nodes (
  id            uuid primary key default gen_random_uuid(),
  owner_email   text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  parent_id     uuid references public.wf_nodes(id) on delete cascade,  -- null＝いちばん上
  kind          text not null check (kind in ('folder', 'file')),
  name          text not null check (char_length(name) between 1 and 255 and name !~ '[/\\]'),
  size          bigint not null default 0 check (size >= 0),
  mime          text,
  drive_file_id text,                                                  -- ファイルのみ
  trashed_at    timestamptz,                                           -- ゴミ箱に入れた日時（null＝通常）
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Supabase 保存領域の置き場所と、アップロードの進み具合（pending＝登録だけ済んでまだ中身が無い／ready＝完了）
alter table public.wf_nodes add column if not exists storage_path text;
alter table public.wf_nodes add column if not exists upload_state text not null default 'ready';
alter table public.wf_nodes drop constraint if exists wf_upload_state_chk;
alter table public.wf_nodes add constraint wf_upload_state_chk check (upload_state in ('pending', 'ready'));
-- ファイルは、ドライブの ID か保存領域の場所のどちらかを必ず持つ
alter table public.wf_nodes drop constraint if exists wf_file_has_drive_id;
alter table public.wf_nodes drop constraint if exists wf_file_has_source;
alter table public.wf_nodes add constraint wf_file_has_source
  check (kind = 'folder' or drive_file_id is not null or storage_path is not null);
create unique index if not exists wf_nodes_storage_path_uq on public.wf_nodes (storage_path) where storage_path is not null;
create index if not exists wf_nodes_owner_parent_idx on public.wf_nodes (owner_email, parent_id);
create unique index if not exists wf_nodes_drive_id_uq on public.wf_nodes (drive_file_id) where drive_file_id is not null;
-- 同じ場所に同じ名前は作れない（大文字小文字は区別しない・ゴミ箱の中は対象外）
create unique index if not exists wf_nodes_name_uq
  on public.wf_nodes (owner_email, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where trashed_at is null;

-- 3) 権限：画面（authenticated）にはフォルダの作成と、名前・場所・ゴミ箱の変更だけ許す ----
alter table public.wf_nodes enable row level security;
revoke all on public.wf_nodes from anon, authenticated;
grant select on public.wf_nodes to authenticated;
grant insert (parent_id, kind, name) on public.wf_nodes to authenticated;
grant update (name, parent_id, trashed_at) on public.wf_nodes to authenticated;

drop policy if exists "wf select own" on public.wf_nodes;
create policy "wf select own" on public.wf_nodes for select to authenticated
  using (is_team_member() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 作成はフォルダだけ（ファイルは Edge Function／登録用の関数 wf_storage_reserve が登録）
drop policy if exists "wf insert folder" on public.wf_nodes;
create policy "wf insert folder" on public.wf_nodes for insert to authenticated
  with check (is_team_member() and kind = 'folder'
              and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "wf update own" on public.wf_nodes;
create policy "wf update own" on public.wf_nodes for update to authenticated
  using (is_team_member() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (is_team_member() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));
-- delete のポリシーは作らない（完全削除は Edge Function、または wf_my_delete が、中身のファイルも一緒に消す）

-- 4) 整合性のトリガー：移動先が自分の子孫／他人のフォルダ／ファイルになる事故を防ぐ・更新日時 ----
create or replace function public.wf_nodes_guard() returns trigger
language plpgsql as $$
declare
  p record;
  loops int := 0;
  cur uuid;
begin
  new.updated_at := now();
  if new.parent_id is not null then
    select kind, owner_email, trashed_at into p from public.wf_nodes where id = new.parent_id;
    if not found or p.kind <> 'folder' or p.owner_email <> new.owner_email then
      raise exception 'wf: 移動先のフォルダが正しくありません';
    end if;
    -- 自分自身・自分の子孫の中へは移せない（フォルダがぐるぐる回る輪になるのを防ぐ）
    if tg_op = 'UPDATE' then
      cur := new.parent_id;
      while cur is not null and loops < 200 loop
        if cur = new.id then
          raise exception 'wf: 自分の中のフォルダには移動できません';
        end if;
        select parent_id into cur from public.wf_nodes where id = cur;
        loops := loops + 1;
      end loop;
    end if;
  end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('wf.internal', true), '') <> '1' then
    -- 持ち主・種類・ドライブ ID・保存場所・サイズ・進み具合は、画面からは変更不可
    -- （完了の確定だけは wf_storage_finalize が wf.internal を立てて行う）
    if new.owner_email <> old.owner_email or new.kind <> old.kind
       or new.drive_file_id is distinct from old.drive_file_id
       or new.storage_path is distinct from old.storage_path
       or new.upload_state <> old.upload_state or new.size <> old.size then
      raise exception 'wf: この項目は変更できません';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists wf_nodes_guard_trg on public.wf_nodes;
create trigger wf_nodes_guard_trg before insert or update on public.wf_nodes
  for each row execute function public.wf_nodes_guard();

-- 5) 使用量（自分の分）。ゴミ箱の中身も、完全に削除するまで容量を使うので数える ----
-- 保存領域のファイルは、申告ではなく「実際に保存されている大きさ」（storage.objects）で数える
-- （申告サイズをごまかして容量を超えられないように）。まだ中身が無い登録（pending）は申告サイズで数える。
create or replace function public.wf_used_calc(p_email text)
returns bigint language sql security definer set search_path = public stable as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, n.size)), 0)::bigint
  from public.wf_nodes n
  left join storage.objects o on o.bucket_id = 'work-folders' and o.name = n.storage_path
  where n.owner_email = lower(p_email) and n.kind = 'file';
$$;
revoke all on function public.wf_used_calc(text) from public, anon, authenticated;

-- 画面が読む：使用量・上限・1 ファイルの上限・いま使っている置き場
drop function if exists public.wf_my_usage();
create or replace function public.wf_my_usage()
returns table (used bigint, quota bigint, file_limit bigint, backend text)
language sql security definer set search_path = public stable as $$
  with b as (select coalesce((select value #>> '{}' from public.wf_config where key = 'backend'), 'storage') as v)
  select
    public.wf_used_calc(lower(coalesce(auth.jwt() ->> 'email', ''))),
    coalesce((select (value #>> '{}')::bigint from public.wf_config where key = 'quota_bytes_' || b.v),
             case when b.v = 'drive' then 5368709120 else 52428800 end)::bigint,
    coalesce((select (value #>> '{}')::bigint from public.wf_config where key = 'file_limit_' || b.v),
             case when b.v = 'drive' then 2147483648 else 52428800 end)::bigint,
    b.v
  from b
  where is_team_member();
$$;
revoke all on function public.wf_my_usage() from public, anon;
grant execute on function public.wf_my_usage() to authenticated;

-- 6) Edge Function 専用の集計（service_role だけが呼べる）--------------------
--    ※ API は 1 回で 1000 行までしか返さないため、件数が多い人でも正しく数えられるよう SQL 側で集計する
create or replace function public.wf_used_bytes(p_email text)
returns bigint language sql security definer set search_path = public stable as $$
  select coalesce(sum(size), 0)::bigint from public.wf_nodes where owner_email = lower(p_email) and kind = 'file';
$$;

-- 指定した項目とその中身（子孫）の、ドライブ上のファイル ID と項目 ID を全部返す
create or replace function public.wf_collect_tree(p_email text, p_ids uuid[])
returns table (node_id uuid, drive_file_id text)
language sql security definer set search_path = public stable as $$
  with recursive t as (
    select n.id, n.drive_file_id from public.wf_nodes n
      where n.owner_email = lower(p_email) and n.id = any(p_ids)
    union
    select c.id, c.drive_file_id from public.wf_nodes c join t on c.parent_id = t.id
      where c.owner_email = lower(p_email)
  )
  select id, drive_file_id from t;
$$;

revoke all on function public.wf_used_bytes(text) from public, anon, authenticated;
revoke all on function public.wf_collect_tree(text, uuid[]) from public, anon, authenticated;
grant execute on function public.wf_used_bytes(text) to service_role;
grant execute on function public.wf_collect_tree(text, uuid[]) to service_role;
