-- ============================================================
-- quote_comments テーブル セットアップ
-- Supabase ダッシュボード → SQL Editor で実行する
-- ============================================================

CREATE TABLE IF NOT EXISTS quote_comments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id  uuid        NOT NULL REFERENCES quote_presets(id) ON DELETE CASCADE,
  body       text        NOT NULL,
  created_by text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE quote_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members can manage comments"
  ON quote_comments FOR ALL
  USING (is_team_member())
  WITH CHECK (is_team_member());

-- インデックス（案件ごとのチャット取得を高速化）
CREATE INDEX IF NOT EXISTS idx_quote_comments_preset_id
  ON quote_comments(preset_id, created_at);
