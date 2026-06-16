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
drop policy if exists "anyone can insert feedbacks" on public.feedbacks;
create policy "anyone can insert feedbacks"
  on public.feedbacks for insert
  to anon, authenticated
  with check (true);

-- 認証済みユーザーは自分のフィードバックを SELECT 可
drop policy if exists "users can view own feedbacks" on public.feedbacks;
create policy "users can view own feedbacks"
  on public.feedbacks for select
  to authenticated
  using (user_id = auth.uid());

-- 管理者用: service_role からは全件 SELECT 可（Supabase Dashboard での確認用）

-- team members can read all feedbacks (for inbox UI)
-- requires: is_team_member() security definer function + allowed_emails table
drop policy if exists "team members can view all feedbacks" on public.feedbacks;
create policy "team members can view all feedbacks"
  on public.feedbacks for select
  to authenticated
  using (is_team_member());

-- team members can update feedback status
drop policy if exists "team members can update feedback status" on public.feedbacks;
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
drop policy if exists "team members can select bookmarks" on public.bookmarks;
create policy "team members can select bookmarks"
  on public.bookmarks for select
  to authenticated
  using (is_team_member());

-- チームメンバーのみ INSERT
drop policy if exists "team members can insert bookmarks" on public.bookmarks;
create policy "team members can insert bookmarks"
  on public.bookmarks for insert
  to authenticated
  with check (is_team_member());

-- チームメンバー全員が DELETE 可
drop policy if exists "team members can delete bookmarks" on public.bookmarks;
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

-- ============================================================
-- 5. user_profiles テーブル（メール → 表示名マッピング）
-- ============================================================
-- チームメンバーが自分の表示名を登録し、プリセット一覧等で
-- メールアドレスの代わりに表示名を使えるようにする。
-- 登録は「作業者名」フィールドの「登録」ボタンから行う。
-- ============================================================
create table if not exists public.user_profiles (
  email        text primary key,
  display_name text,                                  -- null 可（ログインのみで表示名未設定の状態を許容）
  avatar_color text,                                  -- プロフィールのアバター色
  avatar_emoji text,                                  -- プロフィールのアバター絵文字
  last_seen_at timestamptz,                           -- 最終ログイン（在席）時刻＝アクティビティ判定
  updated_at   timestamptz not null default now()
);

-- 既存DB向けマイグレーション（再実行しても安全）
alter table public.user_profiles alter column display_name drop not null;
alter table public.user_profiles add column if not exists avatar_color text;
alter table public.user_profiles add column if not exists avatar_emoji text;
alter table public.user_profiles add column if not exists last_seen_at timestamptz;

alter table public.user_profiles enable row level security;

grant select, insert, update on public.user_profiles to authenticated;

-- チームメンバーは全員の表示名を読み取り可
drop policy if exists "team members can read profiles" on public.user_profiles;
create policy "team members can read profiles"
  on public.user_profiles for select
  using (is_team_member());

-- 自分自身の行のみ作成・更新可
drop policy if exists "own profile upsert" on public.user_profiles;
create policy "own profile upsert"
  on public.user_profiles for all
  using (auth.email() = email)
  with check (auth.email() = email);

-- ============================================================
-- 6. quote_presets — 編集ロック（同時編集の強制ガード）
-- ============================================================
-- 他メンバーが編集中(=ロック保持中・90秒以内)の案件は、保持者以外の
-- 「削除」「上書き保存(update)」をサーバ側(RLS)で拒否する。
-- 読込・プレビューは可（scope: 削除＋上書き拒否）。
-- ロックの取得/更新/解放は security definer 関数で行い、90秒で自動失効。
-- ============================================================

-- ロック列
alter table public.quote_presets
  add column if not exists locked_by text,
  add column if not exists locked_at timestamptz;

-- ロック取得/更新（本人のみ・null/自分/3分超過のときだけ取得可。for update で原子的）
create or replace function public.quote_acquire_lock(p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare cur_by text; cur_at timestamptz;
begin
  if not is_team_member() then return 'DENIED'; end if;
  select locked_by, locked_at into cur_by, cur_at
    from public.quote_presets where id::text = p_id for update;
  if not found then return 'NOTFOUND'; end if;
  if cur_by is null or cur_by = auth.email() or cur_at < now() - interval '90 seconds' then
    update public.quote_presets set locked_by = auth.email(), locked_at = now()
      where id::text = p_id;
    return 'OK';
  else
    return cur_by;   -- 他者が保持中（フレッシュ）
  end if;
end; $$;

-- ロック解放（本人のみ）
create or replace function public.quote_release_lock(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quote_presets set locked_by = null, locked_at = null
    where id::text = p_id and locked_by = auth.email();
end; $$;

grant execute on function public.quote_acquire_lock(text) to authenticated;
grant execute on function public.quote_release_lock(text) to authenticated;

-- RESTRICTIVE ポリシー：他者がロック中(3分以内)なら delete/update を拒否
-- （既存の permissive ポリシーは触らず AND で重ねる。ロック列の更新は
--   上記 security definer 関数が RLS を迂回して行うため影響しない）
drop policy if exists "lock_guard_delete" on public.quote_presets;
create policy "lock_guard_delete" on public.quote_presets
  as restrictive for delete to authenticated
  using (locked_by is null or locked_by = auth.email() or locked_at < now() - interval '90 seconds');

drop policy if exists "lock_guard_update" on public.quote_presets;
create policy "lock_guard_update" on public.quote_presets
  as restrictive for update to authenticated
  using (locked_by is null or locked_by = auth.email() or locked_at < now() - interval '90 seconds');

-- ============================================================
-- 7. 添付ファイル（案件への参考書類・14日で自動削除）
-- ============================================================
-- 案件(quote_presets)に PDF/画像等を添付してチームで保存・閲覧する。
-- 保存先: Storage バケット quote-attachments（非公開・署名URLで閲覧）。
-- メタは quote_attachments テーブル。14日で自動削除（pg_cron）。
-- ============================================================

-- Storage バケット（非公開）
insert into storage.buckets (id, name, public)
  values ('quote-attachments', 'quote-attachments', false)
  on conflict (id) do nothing;

-- メタテーブル
create table if not exists public.quote_attachments (
  id          uuid primary key default gen_random_uuid(),
  preset_id   text not null,           -- quote_presets.id（テキストで保持）
  path        text not null,           -- storage オブジェクトのパス
  name        text not null,           -- 元ファイル名
  mime        text,
  size        bigint,
  uploaded_by text,
  created_at  timestamptz not null default now()
);
create index if not exists quote_attachments_preset_idx on public.quote_attachments(preset_id);
alter table public.quote_attachments enable row level security;
grant select, insert, delete on public.quote_attachments to authenticated;

drop policy if exists "att select" on public.quote_attachments;
create policy "att select" on public.quote_attachments for select to authenticated using (is_team_member());
drop policy if exists "att insert" on public.quote_attachments;
create policy "att insert" on public.quote_attachments for insert to authenticated with check (is_team_member() and uploaded_by = auth.email());
drop policy if exists "att delete" on public.quote_attachments;
create policy "att delete" on public.quote_attachments for delete to authenticated using (is_team_member());

-- Storage オブジェクトのRLS（quote-attachments バケットはチームメンバーのみ）
drop policy if exists "att obj select" on storage.objects;
create policy "att obj select" on storage.objects for select to authenticated
  using (bucket_id = 'quote-attachments' and is_team_member());
drop policy if exists "att obj insert" on storage.objects;
create policy "att obj insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'quote-attachments' and is_team_member());
drop policy if exists "att obj delete" on storage.objects;
create policy "att obj delete" on storage.objects for delete to authenticated
  using (bucket_id = 'quote-attachments' and is_team_member());

-- 14日で自動削除（pg_cron）。pg_cron はダッシュボード Database → Extensions でも有効化可
create extension if not exists pg_cron;
create or replace function public.purge_expired_attachments()
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  delete from storage.objects
    where bucket_id = 'quote-attachments' and created_at < now() - interval '14 days';
  delete from public.quote_attachments
    where created_at < now() - interval '14 days';
end; $$;
-- 毎日 18:00 UTC（≒翌03:00 JST）に実行（同名ジョブは入れ直し）
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-quote-attachments';
exception when others then null; end $$;
select cron.schedule('purge-quote-attachments', '0 18 * * *', $$select public.purge_expired_attachments();$$);
