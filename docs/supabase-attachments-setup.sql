-- ============================================================
-- quote_attachments テーブル + Storage バケット セットアップ
-- Supabase ダッシュボード → SQL Editor で実行する
-- ============================================================

-- 1. テーブル作成
CREATE TABLE IF NOT EXISTS quote_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id    uuid        NOT NULL REFERENCES quote_presets(id) ON DELETE CASCADE,
  storage_path text        NOT NULL,  -- Storage 上のパス: {preset_id}/{ts}_{filename}
  file_name    text        NOT NULL,
  file_size    integer,               -- バイト（圧縮後）
  mime_type    text,
  uploaded_by  text,
  created_at   timestamptz DEFAULT now()
);

-- 2. RLS 有効化
ALTER TABLE quote_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team members can manage attachments"
  ON quote_attachments FOR ALL
  USING (is_team_member())
  WITH CHECK (is_team_member());

-- 3. Storage バケット作成（ダッシュボード Storage タブで手動作成でも可）
--    ※ SQL Editor では storage スキーマへの INSERT が制限される場合あり。
--       その場合はダッシュボードの Storage → New bucket から作成する。
--       設定: Name = quote-attachments, Public = OFF（非公開）

INSERT INTO storage.buckets (id, name, public)
VALUES ('quote-attachments', 'quote-attachments', false)
ON CONFLICT DO NOTHING;

-- 4. Storage オブジェクトの RLS ポリシー
CREATE POLICY "team upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'quote-attachments' AND is_team_member());

CREATE POLICY "team read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'quote-attachments' AND is_team_member());

CREATE POLICY "team delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'quote-attachments' AND is_team_member());
