-- ローカルチャージタブ: チャージマスターテーブル
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run

CREATE TABLE IF NOT EXISTS local_charges (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  direction    text        NOT NULL CHECK (direction IN ('export', 'import')),
  name         text        NOT NULL,
  cat          text,       -- quote カテゴリ値（constants.js CATEGORIES の value）
  amount       numeric,    -- 単価目安
  currency     text        NOT NULL DEFAULT 'JPY',
  unit         text,       -- 式/B/L/CNTR/20ft/40ft/R/T/CBM 等
  port         text,       -- 港・ターミナル（輸出: POL, 輸入: POD）
  carrier      text,       -- 適用船会社
  note         text,       -- 備考
  valid_from   date,       -- 適用開始日
  created_by   text,
  updated_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

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
