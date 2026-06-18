-- 統計タブ: 同義グループテーブル（⭐代表 → 統合・非破壊・チーム共有）
-- 対象フィールド: 'sv' | 'nm' | 'customer' | 'port'（単位 'un' はクライアントのローカル機構を継続使用）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run
--
-- ※ このテーブルが未作成でも、アプリはローカル保存（synonymGroups_v1）に
--    自動フォールバックして動作する（チーム共有のみ無効になる）。

CREATE TABLE IF NOT EXISTS synonym_groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  field       text        NOT NULL CHECK (field IN ('sv', 'nm', 'customer', 'port', 'un')),
  canonical   text        NOT NULL,            -- 代表表記
  aliases     jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- 統合された表記の配列
  created_by  text,
  updated_by  text,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (field, canonical)
);

ALTER TABLE synonym_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members can read synonym_groups" ON synonym_groups
  FOR SELECT USING (is_team_member());

CREATE POLICY "team members can insert synonym_groups" ON synonym_groups
  FOR INSERT WITH CHECK (is_team_member());

CREATE POLICY "team members can update synonym_groups" ON synonym_groups
  FOR UPDATE USING (is_team_member()) WITH CHECK (is_team_member());

CREATE POLICY "team members can delete synonym_groups" ON synonym_groups
  FOR DELETE USING (is_team_member());

CREATE OR REPLACE FUNCTION set_synonym_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER synonym_groups_updated_at
  BEFORE UPDATE ON synonym_groups
  FOR EACH ROW EXECUTE FUNCTION set_synonym_groups_updated_at();

CREATE INDEX IF NOT EXISTS idx_synonym_groups_field ON synonym_groups(field);


-- ============================================================
-- 既存 alias_rules テーブルの CHECK 制約に 'port' を追加
--   （港のエイリアス是正をクラウド同期できるようにする修正）
-- ============================================================
ALTER TABLE alias_rules DROP CONSTRAINT IF EXISTS alias_rules_field_check;
ALTER TABLE alias_rules
  ADD CONSTRAINT alias_rules_field_check CHECK (field IN ('sv', 'nm', 'un', 'port'));
