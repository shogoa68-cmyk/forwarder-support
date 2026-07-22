-- =====================================================================
-- カレンダータブ：祝日・サーチャージ適用日 テーブル ＋ 編集履歴
-- =====================================================================
-- 目的：
--   ・📅カレンダータブ用に、祝日（日本/海外/協力会社）とサーチャージ
--     適用日をチーム共有で管理するテーブルを用意する。
--   ・bookmarks と同じ方針で、更新者・更新時刻の自動記録と編集履歴を
--     トリガーで自動化する。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run。
--   （何度流しても安全なように IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS で冪等化）
--
-- 前提：
--   ・チーム判定関数 public.is_team_member()（bookmarks/quote_presets で使用中のもの）
--     が既に存在すること（無い場合は RLS ポリシー部分でエラーになる）
-- =====================================================================

-- 1) 祝日テーブル（日本 / 海外 / 協力会社） -----------------------------
create table if not exists public.calendar_holidays (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null check (source_type in ('jp','overseas','partner')),
  country_code text,             -- 'JP','CN','US' 等。partner の場合は null 可
  company_name text,             -- source_type='partner' の時のみ使用（協力会社名）
  event_date   date not null,
  name         text not null,    -- 祝日名／休業理由
  note         text,
  ics_uid      text,             -- ICS 取込元の UID（再取込での追跡用。手入力行は null）
  created_by   text,
  updated_by   text,
  updated_at   timestamptz default now(),
  created_at   timestamptz default now()
);

-- 同一ソース・同一日・同一名の重複防止（ICS再取込のUPSERTキー、手入力の重複防止も兼ねる）
create unique index if not exists uq_cal_hol_key
  on public.calendar_holidays (source_type, coalesce(country_code,''), coalesce(company_name,''), event_date, name);

create index if not exists idx_cal_hol_date on public.calendar_holidays (event_date);
create index if not exists idx_cal_hol_type on public.calendar_holidays (source_type, country_code);

-- 2) サーチャージ適用日テーブル -----------------------------------------
create table if not exists public.calendar_surcharges (
  id             uuid primary key default gen_random_uuid(),
  surcharge_name text not null,      -- 例：'GRI','PSS','燃油サーチャージ改定' 等
  carrier        text,               -- 対象船社/キャリア（任意）
  trade_lane     text,               -- 対象航路（任意、自由記述）
  valid_from     date not null,
  valid_to       date,               -- 未定/無期限は null
  amount_note    text,               -- 金額・詳細（自由記述。厳密な数値管理はしない）
  note           text,
  created_by     text,
  updated_by     text,
  updated_at     timestamptz default now(),
  created_at     timestamptz default now()
);

create index if not exists idx_cal_sur_dates on public.calendar_surcharges (valid_from, valid_to);

-- 3) 編集履歴テーブル（2種類とも bookmark_history と同一パターン） -----
create table if not exists public.calendar_holidays_history (
  id          uuid primary key default gen_random_uuid(),
  row_id      uuid,
  action      text not null,
  changed_by  text,
  changed_at  timestamptz not null default now(),
  old_data    jsonb,
  new_data    jsonb
);
create index if not exists idx_cal_hol_hist on public.calendar_holidays_history (row_id, changed_at desc);

create table if not exists public.calendar_surcharges_history (
  id          uuid primary key default gen_random_uuid(),
  row_id      uuid,
  action      text not null,
  changed_by  text,
  changed_at  timestamptz not null default now(),
  old_data    jsonb,
  new_data    jsonb
);
create index if not exists idx_cal_sur_hist on public.calendar_surcharges_history (row_id, changed_at desc);

-- 4) トリガー関数（テーブルごとに一つ。bookmarks の log_bookmark_change() と同一構造） --
create or replace function public.log_calendar_holiday_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
begin
  actor := auth.jwt() ->> 'email';

  if (tg_op = 'INSERT') then
    new.updated_by := actor;
    new.updated_at := now();
    insert into public.calendar_holidays_history (row_id, action, changed_by, new_data)
      values (new.id, 'INSERT', actor, to_jsonb(new));
    return new;

  elsif (tg_op = 'UPDATE') then
    new.updated_by := actor;
    new.updated_at := now();
    insert into public.calendar_holidays_history (row_id, action, changed_by, old_data, new_data)
      values (new.id, 'UPDATE', actor, to_jsonb(old), to_jsonb(new));
    return new;

  else  -- DELETE
    insert into public.calendar_holidays_history (row_id, action, changed_by, old_data)
      values (old.id, 'DELETE', actor, to_jsonb(old));
    return old;
  end if;
end;
$$;

create or replace function public.log_calendar_surcharge_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
begin
  actor := auth.jwt() ->> 'email';

  if (tg_op = 'INSERT') then
    new.updated_by := actor;
    new.updated_at := now();
    insert into public.calendar_surcharges_history (row_id, action, changed_by, new_data)
      values (new.id, 'INSERT', actor, to_jsonb(new));
    return new;

  elsif (tg_op = 'UPDATE') then
    new.updated_by := actor;
    new.updated_at := now();
    insert into public.calendar_surcharges_history (row_id, action, changed_by, old_data, new_data)
      values (new.id, 'UPDATE', actor, to_jsonb(old), to_jsonb(new));
    return new;

  else  -- DELETE
    insert into public.calendar_surcharges_history (row_id, action, changed_by, old_data)
      values (old.id, 'DELETE', actor, to_jsonb(old));
    return old;
  end if;
end;
$$;

-- 5) トリガー登録 -----------------------------------------------------
--    INSERT/UPDATE は BEFORE（updated_by/updated_at を書き換えるため）、
--    DELETE は AFTER（行確定後にスナップショットを記録）。
drop trigger if exists trg_cal_hol_log_iu on public.calendar_holidays;
create trigger trg_cal_hol_log_iu
  before insert or update on public.calendar_holidays
  for each row execute function public.log_calendar_holiday_change();

drop trigger if exists trg_cal_hol_log_d on public.calendar_holidays;
create trigger trg_cal_hol_log_d
  after delete on public.calendar_holidays
  for each row execute function public.log_calendar_holiday_change();

drop trigger if exists trg_cal_sur_log_iu on public.calendar_surcharges;
create trigger trg_cal_sur_log_iu
  before insert or update on public.calendar_surcharges
  for each row execute function public.log_calendar_surcharge_change();

drop trigger if exists trg_cal_sur_log_d on public.calendar_surcharges;
create trigger trg_cal_sur_log_d
  after delete on public.calendar_surcharges
  for each row execute function public.log_calendar_surcharge_change();

-- 6) RLS：チームメンバーは全操作可、履歴は閲覧のみ ----------------------
alter table public.calendar_holidays           enable row level security;
alter table public.calendar_surcharges         enable row level security;
alter table public.calendar_holidays_history   enable row level security;
alter table public.calendar_surcharges_history enable row level security;

drop policy if exists "team select cal_hol" on public.calendar_holidays;
create policy "team select cal_hol" on public.calendar_holidays
  for select using (public.is_team_member());
drop policy if exists "team insert cal_hol" on public.calendar_holidays;
create policy "team insert cal_hol" on public.calendar_holidays
  for insert with check (public.is_team_member());
drop policy if exists "team update cal_hol" on public.calendar_holidays;
create policy "team update cal_hol" on public.calendar_holidays
  for update using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists "team delete cal_hol" on public.calendar_holidays;
create policy "team delete cal_hol" on public.calendar_holidays
  for delete using (public.is_team_member());

drop policy if exists "team select cal_sur" on public.calendar_surcharges;
create policy "team select cal_sur" on public.calendar_surcharges
  for select using (public.is_team_member());
drop policy if exists "team insert cal_sur" on public.calendar_surcharges;
create policy "team insert cal_sur" on public.calendar_surcharges
  for insert with check (public.is_team_member());
drop policy if exists "team update cal_sur" on public.calendar_surcharges;
create policy "team update cal_sur" on public.calendar_surcharges
  for update using (public.is_team_member()) with check (public.is_team_member());
drop policy if exists "team delete cal_sur" on public.calendar_surcharges;
create policy "team delete cal_sur" on public.calendar_surcharges
  for delete using (public.is_team_member());

drop policy if exists "team read cal_hol history" on public.calendar_holidays_history;
create policy "team read cal_hol history" on public.calendar_holidays_history
  for select using (public.is_team_member());
drop policy if exists "team read cal_sur history" on public.calendar_surcharges_history;
create policy "team read cal_sur history" on public.calendar_surcharges_history
  for select using (public.is_team_member());

-- 7) GRANT：ロールへのテーブル権限付与 ---------------------------------
--    環境によっては新規テーブルに authenticated への権限が自動付与されず、
--    「permission denied for table ...」になるため明示的に付与する。
--    （実際の行レベルの絞り込みは上記 RLS ポリシーが行う）
grant select, insert, update, delete on public.calendar_holidays   to authenticated;
grant select, insert, update, delete on public.calendar_surcharges to authenticated;
grant select on public.calendar_holidays_history   to authenticated;
grant select on public.calendar_surcharges_history to authenticated;

-- =====================================================================
-- 動作確認（任意）：
--   select source_type, count(*) from public.calendar_holidays group by 1;
--   update public.calendar_holidays set note = note where id = '<任意のid>';
--   select action, changed_by, changed_at from public.calendar_holidays_history
--     order by changed_at desc limit 5;
-- =====================================================================
