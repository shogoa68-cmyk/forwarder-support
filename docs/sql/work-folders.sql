-- ============================================================
-- 📁 作業フォルダ（ユーザーごとの個人フォルダ。実ファイルは管理者の Google ドライブ）
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：is_team_member() 関数（チーム共有の本体 SQL 適用済み）
--
-- しくみ（やさしく言うと）
--   ・ファイルの「中身」は管理者の Google ドライブに置く（Edge Function `workfolder` が出し入れ）。
--   ・「どのフォルダにどのファイルがあるか」という整理の情報だけをこの表で持つ。
--     だから名前の変更・移動・ゴミ箱は、この表を書き換えるだけで一瞬で終わる。
--   ・自分の行しか見えない（他のメンバーのファイルは見えない・共有なし）。
--   ・ファイル行の追加・完全削除は Edge Function（service_role）だけが行う
--     （画面から勝手に「大きさ 0」や他人のドライブ ID を書いて容量制限をすり抜けられないように）。
-- ============================================================

-- 1) 設定表（容量の上限・ドライブの保存先フォルダ ID）。画面からは読めない（RLS で全拒否）
create table if not exists public.wf_config (
  key   text primary key,
  value jsonb not null
);
alter table public.wf_config enable row level security;
revoke all on public.wf_config from anon, authenticated;
-- 1 人あたりの上限：5GB（変えるときはこの値だけ書き換える）
insert into public.wf_config (key, value)
values ('quota_bytes', to_jsonb(5368709120::bigint))
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
  updated_at    timestamptz not null default now(),
  constraint wf_file_has_drive_id check (kind = 'folder' or drive_file_id is not null)
);
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

-- 作成はフォルダだけ（ファイルは Edge Function が登録）
drop policy if exists "wf insert folder" on public.wf_nodes;
create policy "wf insert folder" on public.wf_nodes for insert to authenticated
  with check (is_team_member() and kind = 'folder'
              and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "wf update own" on public.wf_nodes;
create policy "wf update own" on public.wf_nodes for update to authenticated
  using (is_team_member() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (is_team_member() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));
-- delete のポリシーは作らない（完全削除は Edge Function が Drive のファイルも一緒に消す）

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
  if tg_op = 'UPDATE' then
    -- 持ち主・種類・ドライブ ID・サイズは変更不可
    if new.owner_email <> old.owner_email or new.kind <> old.kind
       or new.drive_file_id is distinct from old.drive_file_id or new.size <> old.size then
      raise exception 'wf: この項目は変更できません';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists wf_nodes_guard_trg on public.wf_nodes;
create trigger wf_nodes_guard_trg before insert or update on public.wf_nodes
  for each row execute function public.wf_nodes_guard();

-- 5) 使用量（自分の分）。ゴミ箱の中身も、完全に削除するまでドライブの容量を使うので数える ----
create or replace function public.wf_my_usage()
returns table (used bigint, quota bigint)
language sql security definer set search_path = public stable as $$
  select
    coalesce((select sum(size) from public.wf_nodes
              where owner_email = lower(coalesce(auth.jwt() ->> 'email', '')) and kind = 'file'), 0)::bigint,
    coalesce((select (value #>> '{}')::bigint from public.wf_config where key = 'quota_bytes'), 5368709120)::bigint
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
