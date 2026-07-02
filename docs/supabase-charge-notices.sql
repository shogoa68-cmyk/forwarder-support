-- 料金改定案内: 案内履歴テーブル（チーム共有・送信状況管理）
-- 目的: 「料金改定案内」サブタブで作成した改定案内を保存し、下書き/送信済みの状況をチームで共有する
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等・再実行安全）
-- 前提: チーム判定関数 is_team_member() と、updated_at 自動更新関数 set_updated_at() が既存であること
--       （docs/supabase-local-charges-setup.sql を実行済みなら両方存在します）

CREATE TABLE IF NOT EXISTS charge_notices (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  direction      text        CHECK (direction IN ('export', 'import')),
  subject        text,       -- 件名
  body           text,       -- 本文
  items          jsonb       DEFAULT '[]'::jsonb,  -- 対象チャージのスナップショット（下記構造）
  customer       text,       -- 宛先（取引先）
  effective_date date,       -- 適用日
  status         text        NOT NULL DEFAULT 'draft',  -- 'draft'（下書き）/ 'sent'（送信済み）
  sent_at        timestamptz,
  created_by     text,
  updated_by     text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- items 要素の構造（参考）:
--   { "name", "carrier", "pol", "pod", "unit", "currency",
--     "old_amount", "new_amount", "diff", "effective_date" }

ALTER TABLE charge_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cn team read"   ON charge_notices;
DROP POLICY IF EXISTS "cn team insert" ON charge_notices;
DROP POLICY IF EXISTS "cn team update" ON charge_notices;
DROP POLICY IF EXISTS "cn team delete" ON charge_notices;

CREATE POLICY "cn team read"   ON charge_notices FOR SELECT USING (is_team_member());
CREATE POLICY "cn team insert" ON charge_notices FOR INSERT WITH CHECK (is_team_member());
CREATE POLICY "cn team update" ON charge_notices FOR UPDATE USING (is_team_member()) WITH CHECK (is_team_member());
CREATE POLICY "cn team delete" ON charge_notices FOR DELETE USING (is_team_member());

-- updated_at / updated_by 自動更新（関数が無い場合のフォールバック定義）
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = (auth.jwt() ->> 'email');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS charge_notices_updated_at ON charge_notices;
CREATE TRIGGER charge_notices_updated_at
  BEFORE UPDATE ON charge_notices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_charge_notices_status
  ON charge_notices(status, effective_date DESC);

NOTIFY pgrst, 'reload schema';
