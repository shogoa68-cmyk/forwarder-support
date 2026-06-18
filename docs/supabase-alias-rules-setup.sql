-- エイリアスルールテーブル（ゆらぎ是正）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run

CREATE TABLE IF NOT EXISTS alias_rules (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  field        text        NOT NULL CHECK (field IN ('sv', 'nm', 'un', 'port')),
  from_value   text        NOT NULL,
  to_value     text        NOT NULL,
  created_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (field, from_value)
);

ALTER TABLE alias_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members can read alias_rules" ON alias_rules
  FOR SELECT USING (is_team_member());

CREATE POLICY "team members can insert alias_rules" ON alias_rules
  FOR INSERT WITH CHECK (is_team_member());

CREATE POLICY "team members can update alias_rules" ON alias_rules
  FOR UPDATE USING (is_team_member()) WITH CHECK (is_team_member());

CREATE POLICY "team members can delete alias_rules" ON alias_rules
  FOR DELETE USING (is_team_member());

CREATE OR REPLACE FUNCTION set_alias_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER alias_rules_updated_at
  BEFORE UPDATE ON alias_rules
  FOR EACH ROW EXECUTE FUNCTION set_alias_rules_updated_at();

CREATE INDEX IF NOT EXISTS idx_alias_rules_field ON alias_rules(field);
