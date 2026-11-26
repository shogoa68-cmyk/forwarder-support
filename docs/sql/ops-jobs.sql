-- 📦 進行管理：見積とつながらない進行（スポット／レギュラー）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
-- 前提: is_team_member()（チームメンバー判定）と quote_presets（見積の案件）が作成済みであること
--
-- 1 行＝1 進行。kind：spot（1 回きりの取引）／regular（同じ料金で繰り返す取引）
-- status：active（進行中）／done（完了）／archived（しまう＝一覧に出さない）
-- data（JSON）：{ dir, mode, route, note,
--                charges:[{id,name,qty,unit,ccy,price}]   … 請求料金の控え（レギュラーは 1 便あたり）
--                st:{v,tpl,s:[作業]}                       … スポットのチェックリスト
--                ships:[{id,label,date,billed,note,st}]    … レギュラーの便ごとのチェックリスト }
-- preset_id：紐づけた見積の案件（無ければ null）。見積を消すと紐付けだけ外れる（進行は残る）
-- 画面は js/quote/ops-progress.js（📦 進行管理タブ）。この SQL を実行するまでは「見積から」の進行だけが動く

create table if not exists public.ops_jobs (
  id          uuid        primary key default gen_random_uuid(),
  kind        text        not null default 'spot' check (kind in ('spot', 'regular')),
  title       text        not null check (length(btrim(title)) > 0),
  customer    text,
  status      text        not null default 'active' check (status in ('active', 'done', 'archived')),
  preset_id   uuid        references public.quote_presets(id) on delete set null,
  data        jsonb       not null default '{}'::jsonb,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_ops_jobs_updated on public.ops_jobs (updated_at desc);
-- 1 つの見積に紐づく進行は 1 件だけ（同じ見積を 2 つの進行で二重に管理しない）
create unique index if not exists uq_ops_jobs_preset on public.ops_jobs (preset_id) where preset_id is not null;

-- 更新日時と更新者はサーバーで決める（画面の時計・申告に頼らない）。作成者は後から変えられない
create or replace function public.ops_jobs_touch() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.jwt() ->> 'email', new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(auth.jwt() ->> 'email', new.updated_by);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_ops_jobs_touch on public.ops_jobs;
create trigger trg_ops_jobs_touch before insert or update on public.ops_jobs
  for each row execute function public.ops_jobs_touch();

alter table public.ops_jobs enable row level security;
revoke all on public.ops_jobs from anon;
grant select, insert, update, delete on public.ops_jobs to authenticated;

drop policy if exists "team members can read ops_jobs" on public.ops_jobs;
create policy "team members can read ops_jobs" on public.ops_jobs
  for select using (is_team_member());

drop policy if exists "team members can insert ops_jobs" on public.ops_jobs;
create policy "team members can insert ops_jobs" on public.ops_jobs
  for insert with check (is_team_member());

drop policy if exists "team members can update ops_jobs" on public.ops_jobs;
create policy "team members can update ops_jobs" on public.ops_jobs
  for update using (is_team_member()) with check (is_team_member());

drop policy if exists "team members can delete ops_jobs" on public.ops_jobs;
create policy "team members can delete ops_jobs" on public.ops_jobs
  for delete using (is_team_member());
