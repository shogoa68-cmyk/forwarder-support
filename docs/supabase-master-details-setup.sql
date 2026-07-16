-- マスター管理タブ: マスター詳細情報テーブル（種別ごとの追加情報・チーム共有）
-- 対象フィールド: 'customer'（ふりがな/担当/所在地/メイン商材/仕向国輸入国/傾向/社内メモ）
--              'nm'（ふりがな/デフォルト単位/デフォルト備考）
--              'sv' / 'carrier' / 'port'（ふりがなのみ）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run
--   ※ ファイル全体を何度実行しても安全（冪等）。
--
-- ※ このテーブルが未作成でも、アプリはローカル保存（masterDetails_v1）に
--    自動フォールバックして動作する（チーム共有のみ無効になる）。
-- ※ synonym_groups と同じ「代表者が編集・全員で共有」方式（投票ではない）。

CREATE TABLE IF NOT EXISTS master_details (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  field       text        NOT NULL CHECK (field IN ('customer', 'nm', 'sv', 'carrier', 'port')),
  value       text        NOT NULL,            -- マスター値（お客様名称 / 品名 / サブコン / キャリア / 港）
  details     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by  text,
  updated_by  text,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (field, value)
);

ALTER TABLE master_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team members can read master_details" ON master_details;
CREATE POLICY "team members can read master_details" ON master_details
  FOR SELECT USING (is_team_member());

DROP POLICY IF EXISTS "team members can insert master_details" ON master_details;
CREATE POLICY "team members can insert master_details" ON master_details
  FOR INSERT WITH CHECK (is_team_member());

DROP POLICY IF EXISTS "team members can update master_details" ON master_details;
CREATE POLICY "team members can update master_details" ON master_details
  FOR UPDATE USING (is_team_member()) WITH CHECK (is_team_member());

DROP POLICY IF EXISTS "team members can delete master_details" ON master_details;
CREATE POLICY "team members can delete master_details" ON master_details
  FOR DELETE USING (is_team_member());

CREATE OR REPLACE FUNCTION set_master_details_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS master_details_updated_at ON master_details;
CREATE TRIGGER master_details_updated_at
  BEFORE UPDATE ON master_details
  FOR EACH ROW EXECUTE FUNCTION set_master_details_updated_at();

CREATE INDEX IF NOT EXISTS idx_master_details_field_value ON master_details(field, value);


-- ============================================================
-- 既存 master_details テーブルの CHECK 制約に sv/carrier/port を追加
--   （ふりがな登録をサブコン・キャリア・港マスターにも拡張する修正。
--     初期の CREATE TABLE（customer/nm のみ）で作成済みの環境向け）
-- ============================================================
ALTER TABLE master_details DROP CONSTRAINT IF EXISTS master_details_field_check;
ALTER TABLE master_details
  ADD CONSTRAINT master_details_field_check CHECK (field IN ('customer', 'nm', 'sv', 'carrier', 'port'));
