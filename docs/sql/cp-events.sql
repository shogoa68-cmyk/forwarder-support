-- ============================================================
-- サイバーポート Webhook：受け取った通知の保存先 cp_events
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：is_team_member() 関数（チーム共有の SQL 適用済み）
-- 書き込み：Edge Function「cp-webhook」だけ（service_role）。読み取り：チームメンバーだけ。
-- 未適用でもアプリは動く（CP(TEST) の「📨 受信した通知」が「表が未作成」と案内するだけ）。
-- ============================================================

-- ① 表
--   dedupe_key … 同じ通知の再送を 1 件にまとめるための印（履歴ID＋通知先の組織。無ければ本文のハッシュ）
--   kind       … message（取引内のチャット）／naccs／report（帳票）／task／process／trade／other
--   payload    … サイバーポートが送ってきた本文そのもの（v2.PostToPartnerByWebhook）
create table if not exists public.cp_events (
  id              bigint generated always as identity primary key,
  received_at     timestamptz not null default now(),
  dedupe_key      text not null unique,
  kind            text not null default 'other',
  history_id      text,
  operation_code  text,
  operation_name  text,
  trade_no        text,
  trade_type      text,
  bl_no           text,
  report_code     text,
  report_name     text,
  report_id       text,
  container_no    text,
  to_org_id       text,
  operated_at     timestamptz,
  payload         jsonb not null
);
create index if not exists cp_events_received_idx on public.cp_events (received_at desc);
create index if not exists cp_events_trade_idx    on public.cp_events (trade_no);
create index if not exists cp_events_history_idx  on public.cp_events (history_id);

-- ② 権限：画面（ログイン済みのチームメンバー）は読むだけ。書き込みのポリシーは作らない
--    （service_role は RLS を通らず書ける＝Edge Function だけが保存できる）
alter table public.cp_events enable row level security;
revoke all on public.cp_events from anon, authenticated;
grant select on public.cp_events to authenticated;

drop policy if exists "cp_events select" on public.cp_events;
create policy "cp_events select" on public.cp_events for select to authenticated
  using (is_team_member());

-- ③ 新着をリアルタイムで画面に流す（すでに入っていれば何もしない）
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cp_events') then
    alter publication supabase_realtime add table public.cp_events;
  end if;
end $$;

-- ④ 古い通知の掃除（任意）：90 日より古いものを消す。必要なときに SQL Editor で実行する。
--    delete from public.cp_events where received_at < now() - interval '90 days';
