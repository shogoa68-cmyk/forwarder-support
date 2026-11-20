-- =====================================================================
-- 📦 進行管理：作業カードの添付ファイル — js/quote/ops-progress.js
--   作業ごとに、B/L のドラフト・INV・写真などのファイルを付けて、チームで共有する。
--   ・target：'q:<見積の案件 id>'／'j:<進行 id>'／'j:<進行 id>:<便 id>'、step_id：チェックリストの作業の id（ops_notes と同じ）
--   ・自動では消さない（業務の記録のため）。消せるのは置いた本人と管理者
--   ・1 ファイル 10MB／1 つの進行（target）で 50 ファイルまで／全体で 500MB まで（Supabase の Free プランの保存領域 1GB を守るため）
--   ・案件・進行を消しても、ファイルは残る（画面には出ない）
-- 実行：Supabase の SQL Editor で、このファイルを丸ごと実行（何度流しても安全）。
-- 前提：is_team_member()・get_my_role()。掃除（アップロードに失敗した残り）の予約には pg_cron（無くても動く）。
-- =====================================================================

-- 1) 表
create table if not exists public.ops_files (
  id           uuid primary key default gen_random_uuid(),
  target       text not null check (length(target) between 3 and 200),
  step_id      text not null check (length(step_id) between 1 and 60),
  storage_path text not null unique,           -- 保存領域の場所：{年月}/{時刻}_{乱数}_{ASCIIの名前}
  file_name    text not null,                  -- 表示名（原文のまま）
  file_size    bigint not null default 0,      -- 実際の大きさ（保存領域の記録から入れる）
  mime_type    text,
  uploaded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists ops_files_target_idx on public.ops_files (target, created_at);

-- 2) 入れるとき：置いた人・日時・大きさはサーバーが決める（画面の申告は信用しない）
create or replace function public.ops_files_bi() returns trigger
language plpgsql security definer set search_path = public, storage as $$
declare sz bigint; n int; tot bigint;
begin
  new.created_at  := now();
  new.uploaded_by := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.file_name   := btrim(coalesce(new.file_name, ''));
  if new.file_name = '' or length(new.file_name) > 200 or new.file_name ~ '[/\\]' then
    raise exception 'ファイル名が正しくありません';
  end if;
  select (metadata ->> 'size')::bigint into sz from storage.objects
    where bucket_id = 'ops-files' and name = new.storage_path;
  if sz is null then raise exception 'ファイルが見つかりません（先にアップロードしてください）'; end if;
  if sz > 10485760 then raise exception '1 ファイルは 10MB までです'; end if;
  new.file_size := sz;
  select count(*) into n from public.ops_files where target = new.target;
  if n >= 50 then raise exception '1 つの進行に付けられるのは 50 ファイルまでです'; end if;
  select coalesce(sum(file_size), 0) into tot from public.ops_files;
  if tot + sz > 524288000 then raise exception '添付ファイルの合計が上限（500MB）に達しました。管理者に相談してください'; end if;
  return new;
end $$;
drop trigger if exists ops_files_bi on public.ops_files;
create trigger ops_files_bi before insert on public.ops_files
  for each row execute function public.ops_files_bi();

-- 3) 権限：読む＝チームメンバー全員、入れる＝決まった列だけ、消す＝置いた本人と管理者、直す＝なし
alter table public.ops_files enable row level security;
revoke all on public.ops_files from anon, authenticated;
grant select, delete on public.ops_files to authenticated;
grant insert (target, step_id, storage_path, file_name, mime_type) on public.ops_files to authenticated;

drop policy if exists "opf select" on public.ops_files;
create policy "opf select" on public.ops_files for select to authenticated using (public.is_team_member());
drop policy if exists "opf insert" on public.ops_files;
create policy "opf insert" on public.ops_files for insert to authenticated with check (public.is_team_member());
drop policy if exists "opf delete" on public.ops_files;
create policy "opf delete" on public.ops_files for delete to authenticated
  using (public.is_team_member() and (uploaded_by = lower(coalesce(auth.jwt() ->> 'email', '')) or public.get_my_role() = 'admin'));

-- 4) 保存領域（非公開バケット ops-files・1 ファイル 10MB まで）
insert into storage.buckets (id, name, public, file_size_limit)
values ('ops-files', 'ops-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

-- 行の有無と持ち主（security definer＝ポリシーの中から使う）
create or replace function public.ops_file_owner(p_path text) returns text
language sql security definer stable set search_path = public as $$
  select coalesce((select coalesce(f.uploaded_by, '') from public.ops_files f where f.storage_path = p_path), '#none')
$$;
grant execute on function public.ops_file_owner(text) to authenticated;

drop policy if exists "opf obj insert" on storage.objects;
create policy "opf obj insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'ops-files' and public.is_team_member()
              and name ~ '^[0-9]{6}/[A-Za-z0-9._-]+$');
-- 読めるのは行のあるファイル。置いたばかりで行がまだ無いもの（15 分以内）も読める
-- （保存領域の API は置いた行を読み返すため、これが無いとアップロードそのものが拒否される）
drop policy if exists "opf obj select" on storage.objects;
create policy "opf obj select" on storage.objects for select to authenticated
  using (bucket_id = 'ops-files' and public.is_team_member()
         and (public.ops_file_owner(name) <> '#none' or created_at > now() - interval '15 minutes'));
-- 消せるのは：置いた本人・管理者・行がまだ無いもの（アップロードの失敗の後始末）
drop policy if exists "opf obj delete" on storage.objects;
create policy "opf obj delete" on storage.objects for delete to authenticated
  using (bucket_id = 'ops-files' and public.is_team_member()
         and (public.ops_file_owner(name) in ('#none', lower(coalesce(auth.jwt() ->> 'email', ''))) or public.get_my_role() = 'admin'));

-- 5) 掃除：行の無いファイル（アップロードの途中で止まった残り）を 1 時間ごとに消す
create or replace function public.ops_files_purge() returns void
language plpgsql security definer set search_path = public, storage as $$
begin
  delete from storage.objects o
   where o.bucket_id = 'ops-files' and o.created_at < now() - interval '15 minutes'
     and not exists (select 1 from public.ops_files f where f.storage_path = o.name);
end $$;
revoke all on function public.ops_files_purge() from public, anon, authenticated;

do $$ begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron を有効にできませんでした（掃除の予約だけ飛ばします。アップロードに失敗した残りが少し残るだけです）';
end $$;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-ops-files';
  perform cron.schedule('purge-ops-files', '17 * * * *', $c$select public.ops_files_purge();$c$);
exception when others then
  raise notice '掃除の予約は未設定です（pg_cron が無い）：%', sqlerrm;
end $$;
