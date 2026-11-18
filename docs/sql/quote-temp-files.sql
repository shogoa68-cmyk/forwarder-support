-- =====================================================================
-- 一時ファイル置き場（案件ごと・3 時間で自動削除）— js/quote/temp-files.js
--   見積を提示するときに添える参考資料（スケジュールなど）を、ごく短い間だけ置いておく場所。
--   ・置いた時刻から 3 時間（DB が決める。画面からは変えられない）。期限が来たファイルは、
--     一覧にも出ず、ダウンロードもできなくなる（掃除の実行を待たない）。実際の削除は 10 分ごとの掃除。
--   ・案件（quote_presets）ごと。案件を開いたチームメンバーが見られる。案件を消すと一緒に消える。
--   ・1 ファイル 25MB／1 案件で 50 ファイル・合計 100MB まで。
-- 実行：Supabase の SQL Editor で、このファイルを丸ごと実行（何度流しても安全）。
-- 前提：quote_presets・is_team_member()。掃除の予約には pg_cron（Database → Extensions でオン）。
-- =====================================================================

-- 1) 表
create table if not exists public.quote_temp_files (
  id           uuid primary key default gen_random_uuid(),
  preset_id    uuid not null references public.quote_presets(id) on delete cascade,
  storage_path text not null unique,           -- 保存領域の場所：{案件ID}/{時刻}_{乱数}_{ASCIIの名前}
  file_name    text not null,                  -- 表示名（原文のまま）
  file_size    bigint not null default 0,      -- 実際の大きさ（保存領域の記録から入れる）
  mime_type    text,
  uploaded_by  text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '3 hours'
);
create index if not exists quote_temp_files_preset_idx on public.quote_temp_files (preset_id, created_at desc);
create index if not exists quote_temp_files_exp_idx on public.quote_temp_files (expires_at);

-- 2) 入れるとき：期限・作成者・大きさをサーバー側で決める（画面の申告は信用しない）
create or replace function public.quote_temp_files_bi() returns trigger
language plpgsql security definer set search_path = public, storage as $$
declare sz bigint; n int; tot bigint;
begin
  new.created_at  := now();
  new.expires_at  := now() + interval '3 hours';
  new.uploaded_by := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.file_name   := btrim(coalesce(new.file_name, ''));
  if new.file_name = '' or length(new.file_name) > 200 or new.file_name ~ '[/\\]' then
    raise exception 'ファイル名が正しくありません';
  end if;
  -- 実際に保存された大きさを使う（先に保存領域へ置いてから、この行を作る）
  select (metadata ->> 'size')::bigint into sz from storage.objects
    where bucket_id = 'quote-temp' and name = new.storage_path;
  if sz is null then raise exception 'ファイルが見つかりません（先にアップロードしてください）'; end if;
  if sz > 26214400 then raise exception '1 ファイルは 25MB までです'; end if;
  new.file_size := sz;
  select count(*), coalesce(sum(file_size), 0) into n, tot from public.quote_temp_files
    where preset_id = new.preset_id and expires_at > now();
  if n >= 50 then raise exception '1 案件に置けるのは 50 ファイルまでです'; end if;
  if tot + sz > 104857600 then raise exception '1 案件の合計は 100MB までです（期限が来るか、削除すると置けます）'; end if;
  return new;
end $$;
drop trigger if exists quote_temp_files_bi on public.quote_temp_files;
create trigger quote_temp_files_bi before insert on public.quote_temp_files
  for each row execute function public.quote_temp_files_bi();

-- 3) 権限：画面（authenticated）は 読む・名前を変える・消す・（決まった列で）入れる だけ
alter table public.quote_temp_files enable row level security;
revoke all on public.quote_temp_files from anon, authenticated;
grant select, delete on public.quote_temp_files to authenticated;
grant insert (preset_id, storage_path, file_name, mime_type) on public.quote_temp_files to authenticated;
grant update (file_name) on public.quote_temp_files to authenticated;

drop policy if exists "qtf select" on public.quote_temp_files;
create policy "qtf select" on public.quote_temp_files for select to authenticated
  using (public.is_team_member() and expires_at > now());          -- 期限が来たものは見えない
drop policy if exists "qtf insert" on public.quote_temp_files;
create policy "qtf insert" on public.quote_temp_files for insert to authenticated
  with check (public.is_team_member());
drop policy if exists "qtf update" on public.quote_temp_files;
create policy "qtf update" on public.quote_temp_files for update to authenticated
  using (public.is_team_member() and expires_at > now()) with check (public.is_team_member());
drop policy if exists "qtf delete" on public.quote_temp_files;
create policy "qtf delete" on public.quote_temp_files for delete to authenticated
  using (public.is_team_member());

-- 4) 保存領域（非公開バケット quote-temp・1 ファイル 25MB まで）
insert into storage.buckets (id, name, public, file_size_limit)
values ('quote-temp', 'quote-temp', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "qtf obj insert" on storage.objects;
create policy "qtf obj insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'quote-temp' and public.is_team_member()
              and name ~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$');
-- 読めるのは「期限内の行がある」ファイルだけ（期限が来たら、掃除の前でも署名つきの URL は使えなくなる）。
-- 例外：置いたばかりで、まだ行を作っていないファイル（15 分以内・行なし）。保存領域の API は「置いた行をそのまま読み返す」ため、
-- この例外が無いと、アップロードそのものが拒否される（INSERT … RETURNING は SELECT のポリシーも通る必要がある）。
-- 行の有無は、期限切れの行も見える関数（security definer）で調べる（表の RLS は期限切れの行を隠すため、ポリシーの中では「行なし」に見えてしまう）
create or replace function public.quote_temp_file_state(p_path text) returns text
language sql security definer stable set search_path = public as $$
  select coalesce((select case when f.expires_at > now() then 'live' else 'expired' end
                   from public.quote_temp_files f where f.storage_path = p_path), 'none')
$$;
grant execute on function public.quote_temp_file_state(text) to authenticated;

drop policy if exists "qtf obj select" on storage.objects;
create policy "qtf obj select" on storage.objects for select to authenticated
  using (bucket_id = 'quote-temp' and public.is_team_member()
         and (public.quote_temp_file_state(name) = 'live'
              or (public.quote_temp_file_state(name) = 'none' and created_at > now() - interval '15 minutes')));
drop policy if exists "qtf obj delete" on storage.objects;
create policy "qtf obj delete" on storage.objects for delete to authenticated
  using (bucket_id = 'quote-temp' and public.is_team_member());

-- 5) 掃除：期限切れの行と、行のない（アップロードに失敗した）ファイルを消す。10 分ごとに呼ぶ
create or replace function public.quote_temp_files_purge() returns void
language plpgsql security definer set search_path = public, storage as $$
begin
  -- 期限切れの行を消し、その実体も同じ処理の中で消す（行だけ先に消えて、実体が読める隙間を作らない）
  with d as (delete from public.quote_temp_files where expires_at <= now() returning storage_path)
  delete from storage.objects o using d where o.bucket_id = 'quote-temp' and o.name = d.storage_path;
  delete from storage.objects o
   where o.bucket_id = 'quote-temp'
     and (o.created_at < now() - interval '3 hours 10 minutes'
          or (o.created_at < now() - interval '15 minutes'
              and not exists (select 1 from public.quote_temp_files f where f.storage_path = o.name)));
end $$;
revoke all on function public.quote_temp_files_purge() from public, anon, authenticated;

-- 6) 10 分ごとに掃除（pg_cron が使えない環境では、この節だけ飛ばしてよい＝期限切れは見えなくなるだけで、ファイルの実体が少し残る）
do $$ begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron を有効にできませんでした（Database → Extensions でオンにしてから、もう一度この節を流してください）';
end $$;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-quote-temp-files';
  perform cron.schedule('purge-quote-temp-files', '*/10 * * * *', $c$select public.quote_temp_files_purge();$c$);
exception when others then
  raise notice '掃除の予約は未設定です（pg_cron が無い）：%', sqlerrm;
end $$;
