-- =====================================================================
-- remark_presets: 貨物種別リマーク＋確認（検証）記録
-- =====================================================================
-- 目的：
--   ①全体リマークの共有プリセット（remark_presets）に「貨物種別」タグを
--     付けられるようにする。貨物種別が一致する案件（例：品名に「自動車」を
--     含む）でだけ、そのプリセットを専用タブとして表示する。
--   ②プリセットの内容が正しいことを「人が確認した」記録を残す
--     （docs/sql/bookmarks-verifications.sql と同じ考え方・同じ形）。
--     自動チェックではなく、複数人が確認することで信頼性を可視化する。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等）。
--
-- 前提：
--   ・public.remark_presets が既に存在すること（label, text, use_count,
--     created_by, created_at 列を持つ既存のチーム共有プリセットテーブル）
--   ・チーム判定関数 public.is_team_member() が存在すること
-- =====================================================================

-- ① 貨物種別タグ（NULL＝従来通りどの案件でも出る汎用プリセット）
alter table public.remark_presets
  add column if not exists cargo_type text;

comment on column public.remark_presets.cargo_type is
  '貨物種別（例：自動車）。NULLなら汎用プリセットとして全案件で表示。値があれば、その貨物種別の案件でのみ専用タブに表示';

create index if not exists idx_remark_presets_cargo_type
  on public.remark_presets (cargo_type);

-- ② 確認（検証）記録
create table if not exists public.remark_preset_verifications (
  id         uuid primary key default gen_random_uuid(),
  preset_id  uuid not null references public.remark_presets(id) on delete cascade,
  checked_by text not null,                       -- 確認者メール
  checked_at timestamptz not null default now(),
  unique (preset_id, checked_by)                   -- 1人1プリセットにつき1回
);

create index if not exists idx_remark_verif_preset
  on public.remark_preset_verifications (preset_id);

grant select, insert, delete on public.remark_preset_verifications to authenticated;

alter table public.remark_preset_verifications enable row level security;

-- 閲覧：チームメンバーは全件閲覧可
drop policy if exists "team read remark verif" on public.remark_preset_verifications;
create policy "team read remark verif" on public.remark_preset_verifications
  for select using (public.is_team_member());

-- 追加：自分のメールの行のみ（他人になりすました確認を防ぐ）
drop policy if exists "team insert own remark verif" on public.remark_preset_verifications;
create policy "team insert own remark verif" on public.remark_preset_verifications
  for insert with check (
    public.is_team_member() and checked_by = (auth.jwt() ->> 'email')
  );

-- 取消：自分のメールの行のみ削除可
drop policy if exists "team delete own remark verif" on public.remark_preset_verifications;
create policy "team delete own remark verif" on public.remark_preset_verifications
  for delete using (
    public.is_team_member() and checked_by = (auth.jwt() ->> 'email')
  );
