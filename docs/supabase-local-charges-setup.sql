-- ローカルチャージタブ: チャージマスターテーブル
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run

CREATE TABLE IF NOT EXISTS local_charges (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  direction    text        NOT NULL CHECK (direction IN ('export', 'import')),
  name         text        NOT NULL,
  full_name    text,       -- 正式名称
  description  text,       -- 解説
  cat          text,       -- quote カテゴリ値（constants.js CATEGORIES の value）
  amount       numeric,    -- 単価目安
  currency     text        NOT NULL DEFAULT 'JPY',
  unit         text,       -- 式/B/L/CNTR/20ft/40ft/R/T/CBM 等
  pol          text,       -- 積み港（POL）・ターミナル
  pod          text,       -- 揚げ港（POD）
  port         text,       -- （旧）港列。互換のため残置。新規は pol/pod を使用
  carrier      text,       -- 適用船会社
  source       text,       -- 参照元（URL/出典）
  note         text,       -- 備考
  valid_from   date,       -- 適用開始日
  valid_to     date,       -- 適用終了日
  attachment_path text,    -- 添付ファイルの Storage パス（チーム共有）
  attachment_name text,    -- 添付ファイルの元ファイル名
  created_by   text,
  updated_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- 既存テーブルがある場合の列追加は docs/supabase-local-charges-migration.sql を参照
-- 添付ファイルのチーム共有（Storage）は docs/supabase-local-charges-storage.sql を参照

ALTER TABLE local_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members can read local_charges" ON local_charges
  FOR SELECT USING (is_team_member());

CREATE POLICY "team members can insert local_charges" ON local_charges
  FOR INSERT WITH CHECK (is_team_member());

CREATE POLICY "team members can update local_charges" ON local_charges
  FOR UPDATE USING (is_team_member()) WITH CHECK (is_team_member());

CREATE POLICY "team members can delete local_charges" ON local_charges
  FOR DELETE USING (is_team_member());

-- updated_at 自動更新（関数が未存在なら作成）
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = (auth.jwt() ->> 'email');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER local_charges_updated_at
  BEFORE UPDATE ON local_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_local_charges_direction
  ON local_charges(direction, name);
