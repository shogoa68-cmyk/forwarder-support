-- ============================================================
-- 📁 作業フォルダ：Supabase の保存領域（Storage）版
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：先に docs/sql/work-folders.sql を実行済みであること（wf_nodes・wf_config・wf_my_usage）
--
-- アップロードの流れ（Edge Function は使わず、画面から直接）
--   1) wf_storage_reserve … 容量・名前・場所を確認して「予約」（pending の行を作り、置き場所を決める）
--   2) 画面が保存領域へ直接アップロード（置き場所＝予約済みの行と一致するときだけ書き込める＝下の RLS）
--   3) wf_storage_finalize … 実際に保存された大きさを確認して確定（ready）。容量超過なら失敗 → 画面が後始末
--   （途中で失敗したら wf_storage_abort。ブラウザを閉じた等で残った pending は、一覧に「未完了」と出るので消せる）
-- 容量は「実際に保存されている大きさ」で数える（申告のごまかしを防ぐ。work-folders.sql の wf_used_calc）。
-- ============================================================

-- 1) 置き場（非公開）。1 ファイルの上限は設定 file_limit_storage と同じ 50MB
insert into storage.buckets (id, name, public, file_size_limit)
values ('work-folders', 'work-folders', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- 2) 「自分の予約済みの場所か」の判定（RLS から使う）
create or replace function public.wf_storage_owns(p_name text, p_state text default null)
returns boolean language sql security definer set search_path = public stable as $$
  select public.is_team_member() and exists (
    select 1 from public.wf_nodes n
    where n.storage_path = p_name
      and n.owner_email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (p_state is null or n.upload_state = p_state)
  );
$$;
revoke all on function public.wf_storage_owns(text, text) from public, anon;
grant execute on function public.wf_storage_owns(text, text) to authenticated;

-- 3) 保存領域のアクセス制限（RLS）
--    ・書き込み：自分の「予約中（pending）」の場所にだけ（予約なしでは置けない・完了後の上書きもできない）
--    ・読み取り／削除：自分の行に結び付いたファイルだけ
drop policy if exists "wf storage insert" on storage.objects;
create policy "wf storage insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'work-folders' and public.wf_storage_owns(name, 'pending'));

drop policy if exists "wf storage select" on storage.objects;
create policy "wf storage select" on storage.objects for select to authenticated
  using (bucket_id = 'work-folders' and public.wf_storage_owns(name));

drop policy if exists "wf storage delete" on storage.objects;
create policy "wf storage delete" on storage.objects for delete to authenticated
  using (bucket_id = 'work-folders' and public.wf_storage_owns(name));
-- update のポリシーは作らない（上書きを許さない）

-- 4) 予約：容量・名前・場所を確認して、pending の行を作る ------------------
create or replace function public.wf_storage_reserve(p_parent uuid, p_name text, p_size bigint, p_mime text)
returns public.wf_nodes
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_name  text := btrim(coalesce(p_name, ''));
  v_id    uuid := gen_random_uuid();
  v_quota bigint;
  v_limit bigint;
  v_pend  int;
  par     record;
  r       public.wf_nodes;
begin
  if v_email = '' or not public.is_team_member() then raise exception 'wf: ログインが必要です（チームメンバーのみ使えます）'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 255 or v_name ~ '[/\\]' or v_name in ('.', '..') then
    raise exception 'wf: ファイル名が正しくありません';
  end if;
  if p_size is null or p_size < 0 then raise exception 'wf: ファイルの大きさが正しくありません'; end if;

  select coalesce((select (value #>> '{}')::bigint from public.wf_config where key = 'file_limit_storage'), 52428800) into v_limit;
  select coalesce((select (value #>> '{}')::bigint from public.wf_config where key = 'quota_bytes_storage'), 52428800) into v_quota;
  if p_size > v_limit then
    raise exception 'wf: 1 ファイルの上限は % MB です', (v_limit / 1048576);
  end if;

  if p_parent is not null then
    select kind, owner_email, trashed_at into par from public.wf_nodes where id = p_parent;
    if not found or par.kind <> 'folder' or par.owner_email <> v_email or par.trashed_at is not null then
      raise exception 'wf: 保存先のフォルダが見つかりません';
    end if;
  end if;

  -- 「未完了」が溜まりすぎていたら、先に片付けてもらう
  select count(*) into v_pend from public.wf_nodes where owner_email = v_email and upload_state = 'pending';
  if v_pend >= 10 then raise exception 'wf: 未完了のアップロードが多すぎます。一覧の「未完了」の項目を削除してください'; end if;

  if public.wf_used_calc(v_email) + p_size > v_quota then
    raise exception 'wf: 容量の上限（% MB）を超えます', (v_quota / 1048576);
  end if;

  begin
    insert into public.wf_nodes (id, owner_email, parent_id, kind, name, size, mime, storage_path, upload_state)
    values (v_id, v_email, p_parent, 'file', v_name, p_size, nullif(left(p_mime, 200), ''),
            auth.uid()::text || '/' || v_id::text, 'pending')
    returning * into r;
  exception when unique_violation then
    raise exception 'wf: 同じ名前のファイルがあります';
  end;
  return r;
end $$;

-- 5) 確定：実際に保存された大きさを確かめて、容量内なら完了（ready）にする ------
create or replace function public.wf_storage_finalize(p_id uuid)
returns public.wf_nodes
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_size  bigint;
  v_mime  text;
  v_quota bigint;
  v_limit bigint;
  r       public.wf_nodes;
begin
  if v_email = '' or not public.is_team_member() then raise exception 'wf: ログインが必要です'; end if;
  select * into r from public.wf_nodes
   where id = p_id and owner_email = v_email and kind = 'file' and upload_state = 'pending';
  if not found then raise exception 'wf: アップロードの予約が見つかりません'; end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype' into v_size, v_mime
    from storage.objects o where o.bucket_id = 'work-folders' and o.name = r.storage_path;
  if not found then raise exception 'wf: アップロードしたファイルを確認できません'; end if;

  select coalesce((select (value #>> '{}')::bigint from public.wf_config where key = 'file_limit_storage'), 52428800) into v_limit;
  select coalesce((select (value #>> '{}')::bigint from public.wf_config where key = 'quota_bytes_storage'), 52428800) into v_quota;
  if v_size > v_limit then raise exception 'wf: 1 ファイルの上限は % MB です', (v_limit / 1048576); end if;
  -- この行は実際の大きさで数えられるので、合計がそのまま「確定後の使用量」になる
  if public.wf_used_calc(v_email) > v_quota then raise exception 'wf: 容量の上限（% MB）を超えます', (v_quota / 1048576); end if;

  perform set_config('wf.internal', '1', true);
  update public.wf_nodes set size = v_size, upload_state = 'ready', mime = coalesce(mime, v_mime)
   where id = p_id returning * into r;
  perform set_config('wf.internal', '', true);
  return r;
end $$;

-- 6) 取り消し：失敗した予約（pending）の行を消す（保存領域のファイルは画面が先に消す）
create or replace function public.wf_storage_abort(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.wf_nodes
   where id = p_id and upload_state = 'pending'
     and owner_email = lower(coalesce(auth.jwt() ->> 'email', ''));
end $$;

-- 7) 完全削除の入口（保存領域版）：中身のファイルの場所を調べ → 画面が保存領域から消し → 行を消す ----
create or replace function public.wf_my_tree(p_ids uuid[])
returns table (node_id uuid, storage_path text)
language sql security definer set search_path = public stable as $$
  with recursive t as (
    select n.id, n.storage_path from public.wf_nodes n
      where n.owner_email = lower(coalesce(auth.jwt() ->> 'email', '')) and n.id = any(p_ids)
    union
    select c.id, c.storage_path from public.wf_nodes c join t on c.parent_id = t.id
      where c.owner_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  select id, storage_path from t where public.is_team_member();
$$;

create or replace function public.wf_my_delete(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_team_member() then raise exception 'wf: ログインが必要です'; end if;
  delete from public.wf_nodes
   where id = any(p_ids) and owner_email = lower(coalesce(auth.jwt() ->> 'email', ''));
  get diagnostics n = row_count;       -- 子は on delete cascade
  return n;
end $$;

revoke all on function public.wf_storage_reserve(uuid, text, bigint, text) from public, anon;
revoke all on function public.wf_storage_finalize(uuid) from public, anon;
revoke all on function public.wf_storage_abort(uuid) from public, anon;
revoke all on function public.wf_my_tree(uuid[]) from public, anon;
revoke all on function public.wf_my_delete(uuid[]) from public, anon;
grant execute on function public.wf_storage_reserve(uuid, text, bigint, text) to authenticated;
grant execute on function public.wf_storage_finalize(uuid) to authenticated;
grant execute on function public.wf_storage_abort(uuid) to authenticated;
grant execute on function public.wf_my_tree(uuid[]) to authenticated;
grant execute on function public.wf_my_delete(uuid[]) to authenticated;
