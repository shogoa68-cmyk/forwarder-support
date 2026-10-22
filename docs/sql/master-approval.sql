-- マスターの承認制（申請 → 管理者が承認）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
--
-- 前提: is_team_member()（チームメンバー判定）と get_my_role()（allowed_emails.role を返す）が作成済みであること
--
-- 変わること
--   ・マスター（master_votes）の登録・解除は管理者（role = 'admin'）だけ。管理者は、ほかの人が登録したマスターも解除できる
--   ・メンバーは master_requests に「申請」を出す。管理者が承認するとマスターになる（却下もできる）
--   ・既存のマスター（master_votes の行）はそのまま有効
-- このファイルを実行するまでは、アプリは従来どおり（メンバーも直接マスター登録）に動く

-- ===== 申請テーブル =====
create table if not exists public.master_requests (
  id            uuid        primary key default gen_random_uuid(),
  field         text        not null,                          -- 'sv' | 'carrier' | 'nm' | 'un' | 'customer' | 'port'
  value         text        not null,                          -- 申請する名称（代表名）
  requested_by  text        not null,                          -- 申請者メール
  status        text        not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  decided_by    text,                                          -- 承認／却下した管理者
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
-- 同じ名称の申請中は 1 件だけ（承認・却下済みの履歴は残す）
create unique index if not exists uq_master_requests_pending
  on public.master_requests (field, value) where status = 'pending';
create index if not exists idx_master_requests_status on public.master_requests (status, created_at desc);

alter table public.master_requests enable row level security;

-- テーブル権限（RLS とは別。これが無いと "permission denied for table master_requests" になり、
-- アプリは申請テーブルを使えないと判断して承認制を有効にしない）
grant select, insert, update, delete on public.master_requests to authenticated;

drop policy if exists "team members can read master requests" on public.master_requests;
create policy "team members can read master requests" on public.master_requests
  for select using (is_team_member());

-- 申請は本人名義でのみ（申請中の状態で作る）
drop policy if exists "team members can request masters" on public.master_requests;
create policy "team members can request masters" on public.master_requests
  for insert with check (
    is_team_member()
    and requested_by = (auth.jwt() ->> 'email')
    and status = 'pending'
  );

-- 承認・却下は管理者だけ
drop policy if exists "admins can decide master requests" on public.master_requests;
create policy "admins can decide master requests" on public.master_requests
  for update using (is_team_member() and get_my_role() = 'admin')
  with check (is_team_member() and get_my_role() = 'admin');

-- 取り消し：申請中の自分の申請、または管理者
drop policy if exists "requesters or admins can delete master requests" on public.master_requests;
create policy "requesters or admins can delete master requests" on public.master_requests
  for delete using (
    is_team_member()
    and ((requested_by = (auth.jwt() ->> 'email') and status = 'pending') or get_my_role() = 'admin')
  );

-- ===== マスター（master_votes）：登録・解除は管理者だけ =====
drop policy if exists "team members can insert own votes" on public.master_votes;
drop policy if exists "admins can insert votes" on public.master_votes;
create policy "admins can insert votes" on public.master_votes
  for insert with check (
    is_team_member()
    and get_my_role() = 'admin'
    and voter_email = (auth.jwt() ->> 'email')
  );

-- 管理者は、ほかの人が登録したマスターも解除できる（誤登録の取り消し）
drop policy if exists "team members can delete own votes" on public.master_votes;
drop policy if exists "admins can delete votes" on public.master_votes;
create policy "admins can delete votes" on public.master_votes
  for delete using (is_team_member() and get_my_role() = 'admin');
