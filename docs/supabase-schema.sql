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

-- テーブルへのアクセス権付与（SQL Editor で作成した場合は手動 GRANT が必要）
grant usage on schema public to anon, authenticated;
grant insert on public.feedbacks to anon, authenticated;
grant select, update on public.feedbacks to authenticated;

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

-- team members can read all feedbacks (for inbox UI)
-- requires: is_team_member() security definer function + allowed_emails table
create policy "team members can view all feedbacks"
  on public.feedbacks for select
  to authenticated
  using (is_team_member());

-- team members can update feedback status
create policy "team members can update feedback status"
  on public.feedbacks for update
  to authenticated
  using (is_team_member())
  with check (is_team_member());

-- ============================================================
-- 2. quote_presets — 詳細検索用カラム追加（マイグレーション）
-- ============================================================
-- quote_presetsテーブルに詳細検索用カラムを追加
-- （テーブル自体は cloud.js / Supabase Dashboard で作成済み前提）
alter table public.quote_presets
  add column if not exists incoterms      text default '',
  add column if not exists transport_mode text default '',
  add column if not exists pol            text default '',
  add column if not exists pod            text default '',
  add column if not exists carrier        text default '';

-- ============================================================
-- 3. bookmarks テーブル（チーム共有ブックマーク）
-- ============================================================
create table if not exists public.bookmarks (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,           -- リンク名
  url          text,                    -- URL（省略可・メモのみ登録を許可）
  carrier_type text not null default 'general',  -- 'FCL' | 'LCL' | 'general'
  carrier      text,                    -- 会社名（null = 汎用）
  "function"   text not null,           -- 'スケジュール' | '航路' | '輸入サーチャージ' | ...
  note         text,                    -- アクセス方法・注意点
  created_by   text,                    -- email
  created_at   timestamptz not null default now()
);

alter table public.bookmarks enable row level security;

grant select, insert, update, delete on public.bookmarks to authenticated;

-- チームメンバーのみ SELECT
create policy "team members can select bookmarks"
  on public.bookmarks for select
  to authenticated
  using (is_team_member());

-- チームメンバーのみ INSERT
create policy "team members can insert bookmarks"
  on public.bookmarks for insert
  to authenticated
  with check (is_team_member());

-- チームメンバー全員が DELETE 可
create policy "team members can delete bookmarks"
  on public.bookmarks for delete
  to authenticated
  using (is_team_member());

-- ============================================================
-- 4. 将来用テーブル（準備のみ・未使用）
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
