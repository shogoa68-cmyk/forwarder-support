-- ============================================================
-- フォワーダー支援 — Supabase スキーマ定義
-- Supabase Dashboard > SQL Editor でこのファイルを実行してください
-- ============================================================

-- ============================================================
-- 1. feedbacks テーブル（フィードバック受付）
-- ============================================================
create table if not exists public.feedbacks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  category    text not null,   -- 'bug' | 'request' | 'question' | 'other'
  section     text not null,   -- 送信元タブ/セクション名
  body        text not null,   -- フィードバック本文
  status      text not null default 'open',  -- 'open' | 'resolved' | 'wontfix'
  created_at  timestamptz not null default now()
);

-- RLS 有効化
alter table public.feedbacks enable row level security;

-- 誰でも INSERT 可（anon / authenticated どちらも）
-- user_id は認証済みのときのみ設定される
create policy "anyone can insert feedbacks"
  on public.feedbacks for insert
  to anon, authenticated
  with check (true);

-- 認証済みユーザーは自分のフィードバックを SELECT 可
create policy "users can view own feedbacks"
  on public.feedbacks for select
  to authenticated
  using (user_id = auth.uid());

-- 管理者用: service_role からは全件 SELECT 可（Supabase Dashboard での確認用）

-- ============================================================
-- 2. 将来用テーブル（準備のみ・未使用）
-- ============================================================

-- quotes テーブル（見積データ保存 — Supabase連携フェーズ2で使用）
-- create table if not exists public.quotes (
--   id            uuid primary key default gen_random_uuid(),
--   user_id       uuid references auth.users(id) on delete set null,
--   title         text,
--   customer_name text,
--   direction     text,          -- 'export' | 'import' | 'both'
--   transport     text,          -- 'FCL' | 'LCL' | 'Air'
--   status        text default 'draft',  -- 'draft' | 'submitted' | 'won' | 'lost' | 'hold'
--   data_json     jsonb,         -- 見積全データ（localStorage の quoteData 相当）
--   created_at    timestamptz default now(),
--   updated_at    timestamptz default now()
-- );
