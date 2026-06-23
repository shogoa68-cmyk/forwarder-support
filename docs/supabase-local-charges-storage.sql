-- ローカルチャージ: 添付ファイルの Supabase Storage 共有セットアップ
-- 目的: 添付PDF等をブラウザ localStorage ではなく Supabase に保存し、チームで共有する
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等・再実行安全）
-- 前提: チーム判定関数 is_team_member() が既に存在すること（クラウド共有セットアップ済み）

-- 1) local_charges に添付メタ列を追加 ------------------------------------------
ALTER TABLE local_charges ADD COLUMN IF NOT EXISTS attachment_path text;  -- Storage 内パス
ALTER TABLE local_charges ADD COLUMN IF NOT EXISTS attachment_name text;  -- 元のファイル名

-- 2) Storage バケットを作成（非公開） ----------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('local-charge-files', 'local-charge-files', false)
ON CONFLICT (id) DO NOTHING;

-- 3) storage.objects への RLS ポリシー（チームメンバーのみ読み書き） ----------
--    storage.objects は既定で RLS 有効。下記はこのバケット限定の追加ポリシー。
DROP POLICY IF EXISTS "lcf team read"   ON storage.objects;
DROP POLICY IF EXISTS "lcf team insert" ON storage.objects;
DROP POLICY IF EXISTS "lcf team update" ON storage.objects;
DROP POLICY IF EXISTS "lcf team delete" ON storage.objects;

CREATE POLICY "lcf team read" ON storage.objects
  FOR SELECT USING (bucket_id = 'local-charge-files' AND is_team_member());

CREATE POLICY "lcf team insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'local-charge-files' AND is_team_member());

CREATE POLICY "lcf team update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'local-charge-files' AND is_team_member())
              WITH CHECK (bucket_id = 'local-charge-files' AND is_team_member());

CREATE POLICY "lcf team delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'local-charge-files' AND is_team_member());

-- 4) スキーマキャッシュを即時リロード（列追加の反映を早める保険） --------------
NOTIFY pgrst, 'reload schema';

-- 補足:
--   * ダウンロードは createSignedUrl（有効期限つき署名URL）で行う想定。
--     上記 SELECT ポリシーにより、チームメンバーのみ署名URLを発行・取得できる。
--   * アップロードは {charge_id}/{timestamp}_{filename} のパスに保存する。
--   * 既存の localStorage 添付（lcAttachments_v1）はクラウドへ自動移行されない。
--     必要なら各チャージを開いて添付し直すと Storage 側へ保存される。
