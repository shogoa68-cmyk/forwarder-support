-- ============================================================
-- 🚢 サイバーポート：動静の自動確認（cp-watch）の保存先と「次に確認する案件を選ぶ」仕組み
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：is_team_member() 関数と quote_presets 表（チーム共有の本体 SQL 適用済み）
--
-- しくみ（やさしく言うと）
--   ・cp_watch_targets … 「追跡する案件」の名簿。案件ごとに 1 行。追跡中のフラグ・照合キー（B/L番号など）・
--                        最後に確認した時刻・前回の写し（スナップショット）を持つ。
--   ・cp_changes       … 前回から「変わったこと」の記録（ETA が 2 日遅れた、搬出可になった…）。朝夕のダイジェストの元。
--   ・cp_watch_runs    … 自動確認を動かした記録（いつ・何件・成功/失敗）。動かなかった朝夕に気づくため。
--   ・cp_watch_pick()  … 「次に確認する案件」を選ぶ。急ぐもの（期限が近い）を先に、同じ強さなら一番長く確認していないものを先に。
--   ・確認のたびに書き込むのは Edge Function（cp-proxy の watch_run）だけ。画面（ブラウザ）は名簿の編集と、結果を読むだけ。
--   ・サイバーポートへは読み取りしかしない（書き込む処理はそもそも無い）。
--
-- 受注済みの案件だけを追う：quote_presets.status が「受注」のものだけが対象（pick の条件）。
-- ============================================================

-- 1) 追跡する案件の名簿
create table if not exists public.cp_watch_targets (
  preset_id           uuid primary key references public.quote_presets(id) on delete cascade,
  direction           text not null check (direction in ('import', 'export')),   -- 輸入／輸出
  bl_no               text,                                   -- B/L番号（輸入）
  booking_no          text,                                   -- ブッキング番号（輸出）
  container_nos       text[] not null default '{}',           -- コンテナ番号（番号だけで追うとき）
  trace               boolean not null default true,          -- 追跡中フラグ（人が切り替える）
  state               text not null default 'active' check (state in ('active', 'done', 'ask')),  -- 追跡中／追跡完了／終了の確認待ち
  state_note          text,                                   -- 完了・確認待ちの理由
  state_at            timestamptz,
  ask_snooze_until    timestamptz,                            -- 「もう少し追う」を選んだとき、この時刻まで確認の知らせを止める
  last_checked_at     timestamptz,                            -- 最後に確認した時刻
  last_status         text,                                   -- ok／nodata／error
  last_error          text,
  consecutive_errors  integer not null default 0,
  urgent_at           timestamptz,                            -- いちばん近い期限（確認の優先順位に使う）
  snapshot            jsonb,                                  -- 前回の写し（項目の配列）
  created_by          text,
  updated_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists cp_watch_targets_pick_idx on public.cp_watch_targets (trace, state, last_checked_at);

-- 2) 変わったことの記録
create table if not exists public.cp_changes (
  id           bigserial primary key,
  preset_id    uuid not null references public.quote_presets(id) on delete cascade,
  run_id       bigint,
  detected_at  timestamptz not null default now(),
  k            text,                                          -- 項目の印
  scope        text not null,                                 -- コンテナ XXXX／本船 XXXX／追跡
  label        text not null,                                 -- 項目名
  old_val      text,
  new_val      text,
  kind         text not null check (kind in ('new', 'changed', 'cleared', 'state')),
  sev          text not null check (sev in ('alert', 'warn', 'info')),
  note         text
);
create index if not exists cp_changes_preset_idx on public.cp_changes (preset_id, detected_at desc);
create index if not exists cp_changes_time_idx on public.cp_changes (detected_at desc);

-- 3) 自動確認の実行記録
create table if not exists public.cp_watch_runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  picked       integer not null default 0,
  ok           integer not null default 0,
  nodata       integer not null default 0,
  failed       integer not null default 0,
  changed      integer not null default 0,
  calls        integer not null default 0,
  note         text
);
create index if not exists cp_watch_runs_time_idx on public.cp_watch_runs (started_at desc);

-- 4) 権限（RLS）
--    ・名簿：チームメンバーが読み書きできる（追跡の入り切り・キーの入力は画面から）
--    ・変化・実行記録：チームメンバーは読むだけ（書き込みは service_role の Edge Function だけ）
alter table public.cp_watch_targets enable row level security;
alter table public.cp_changes       enable row level security;
alter table public.cp_watch_runs    enable row level security;

drop policy if exists "cp_watch_targets team all" on public.cp_watch_targets;
create policy "cp_watch_targets team all" on public.cp_watch_targets
  for all to authenticated using (is_team_member()) with check (is_team_member());

drop policy if exists "cp_changes team read" on public.cp_changes;
create policy "cp_changes team read" on public.cp_changes
  for select to authenticated using (is_team_member());

drop policy if exists "cp_watch_runs team read" on public.cp_watch_runs;
create policy "cp_watch_runs team read" on public.cp_watch_runs
  for select to authenticated using (is_team_member());

revoke all on public.cp_watch_targets, public.cp_changes, public.cp_watch_runs from anon;

-- 画面から名簿を書き換えるときに、確認の結果の列（前回の写し・最後の確認など）を偽って書けないようにする
-- （結果の列は Edge Function だけが書く。画面が書けるのは「追跡の入り切り・キー・向き・もう少し追う」だけ）
revoke insert, update on public.cp_watch_targets from authenticated;
grant insert (preset_id, direction, bl_no, booking_no, container_nos, trace, state, state_note, ask_snooze_until, created_by, updated_by)
  on public.cp_watch_targets to authenticated;
grant update (direction, bl_no, booking_no, container_nos, trace, state, state_note, ask_snooze_until, updated_by, updated_at)
  on public.cp_watch_targets to authenticated;
grant select, delete on public.cp_watch_targets to authenticated;
grant select on public.cp_changes, public.cp_watch_runs to authenticated;
-- 確認の結果を書き込むのは Edge Function（service_role）。初期設定に頼らず、必要な権限を明示する
grant select, insert, update, delete on public.cp_watch_targets, public.cp_changes, public.cp_watch_runs to service_role;
grant usage, select on sequence public.cp_changes_id_seq, public.cp_watch_runs_id_seq to service_role;

-- 5) 次に確認する案件を選ぶ（Edge Function だけが呼べる）
--    条件：追跡中・状態が「追跡中」・案件の状態が「受注」
--          ・p_min_gap（既定 2 時間）以内に確認したものは選ばない（同じ時間帯に同じ案件を何度も確認しない）
--          ・3 回続けて失敗している案件は 6 時間あけてから（相手先に負担をかけない）
--    順番：期限が 48 時間以内（または過ぎた）案件を先に → 一番長く確認していない案件から
create or replace function public.cp_watch_pick(p_n integer default 5, p_min_gap interval default interval '2 hours')
returns setof public.cp_watch_targets
language sql
security definer
set search_path = public
as $$
  select t.*
    from public.cp_watch_targets t
    join public.quote_presets q on q.id = t.preset_id
   where t.trace
     and t.state = 'active'
     and q.status in ('受注', 'won')
     and (t.last_checked_at is null or t.last_checked_at < now() - p_min_gap)
     and (t.consecutive_errors < 3 or t.last_checked_at < now() - interval '6 hours')
   order by (case when t.urgent_at is not null and t.urgent_at <= now() + interval '48 hours' then 0 else 1 end),
            t.last_checked_at asc nulls first
   limit greatest(1, least(coalesce(p_n, 5), 20));
$$;
revoke all on function public.cp_watch_pick(integer, interval) from public, anon, authenticated;
grant execute on function public.cp_watch_pick(integer, interval) to service_role;

-- 6) 古い記録の掃除（変化は 90 日・実行記録は 30 日で消す）。cron から呼ぶ
create or replace function public.cp_watch_purge()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.cp_changes   where detected_at < now() - interval '90 days';
  delete from public.cp_watch_runs where started_at  < now() - interval '30 days';
$$;
revoke all on function public.cp_watch_purge() from public, anon, authenticated;
grant execute on function public.cp_watch_purge() to service_role;

-- ============================================================
-- 7) 予約実行（pg_cron ＋ pg_net）…ここから下は「準備（秘密の登録）が済んでから」1 回だけ実行する
--    秘密（合言葉・鍵）は、このファイルには書かない。Supabase の Vault に入れて、予約の中から読む。
--
--  (a) 拡張を有効にする（Database → Extensions で pg_cron・pg_net をオン）
--  (b) Edge Function に秘密を置く（supabase secrets set CP_WATCH_SECRET=<長いランダムな文字列>）
--  (c) 同じ文字列と、プロジェクトの URL・anon キーを Vault に入れる（SQL Editor で、値は自分で置き換えて 1 回だけ実行）：
--        select vault.create_secret('<(b)と同じ文字列>', 'cp_watch_secret');
--        select vault.create_secret('https://<project-ref>.supabase.co', 'cp_watch_url');
--        select vault.create_secret('<anon キー（公開してよい鍵）>', 'cp_watch_anon');
--  (d) 下の予約を作る（時刻は UTC。日本時間 − 9 時間）：
--        朝：日本時間 6:00〜8:20 → UTC 21:00〜23:20（前日）
--        夕：日本時間 14:00〜16:20 → UTC 05:00〜07:20
--        10 分おきに数件ずつ確認する。朝 8:30・夕 16:30 のダイジェストは、集めた結果から作る（別の段階）。
--        土日を止めたいときは、日付の部分（* * *）の最後を 1-5 などに変える。
--
-- create or replace function public.cp_watch_call(p_n integer default 5)
-- returns void language plpgsql security definer set search_path = public as $f$
-- declare v_url text; v_secret text; v_anon text;
-- begin
--   select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'cp_watch_url';
--   select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cp_watch_secret';
--   select decrypted_secret into v_anon   from vault.decrypted_secrets where name = 'cp_watch_anon';
--   if v_url is null or v_secret is null then return; end if;
--   perform net.http_post(
--     url     := v_url || '/functions/v1/cp-proxy',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(v_anon, ''), 'x-cp-watch-secret', v_secret),
--     body    := jsonb_build_object('action', 'watch_run', 'n', p_n),
--     timeout_milliseconds := 120000);
-- end $f$;
-- revoke all on function public.cp_watch_call(integer) from public, anon, authenticated;
--
-- select cron.schedule('cp-watch-morning-a', '*/10 21,22 * * *',  $$select public.cp_watch_call(5);$$);
-- select cron.schedule('cp-watch-morning-b', '0,10,20 23 * * *',   $$select public.cp_watch_call(5);$$);
-- select cron.schedule('cp-watch-evening-a', '*/10 5,6 * * *',     $$select public.cp_watch_call(5);$$);
-- select cron.schedule('cp-watch-evening-b', '0,10,20 7 * * *',    $$select public.cp_watch_call(5);$$);
-- select cron.schedule('cp-watch-purge',     '30 18 * * *',        $$select public.cp_watch_purge();$$);
--
--   止めるとき：select cron.unschedule('cp-watch-morning-a');（ほかの名前も同様）
-- ============================================================
