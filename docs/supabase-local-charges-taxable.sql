-- ローカルチャージ: 消費税区分（課税/免税）列の追加
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等・再実行安全）

ALTER TABLE local_charges ADD COLUMN IF NOT EXISTS taxable boolean NOT NULL DEFAULT false;  -- true=課税 / false=免税

-- PostgREST のスキーマキャッシュを即時リロード（反映が遅い場合の保険）
NOTIFY pgrst, 'reload schema';
