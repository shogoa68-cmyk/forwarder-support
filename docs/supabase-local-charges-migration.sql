-- ローカルチャージ: 既存テーブルへの列追加マイグレーション
-- 症状: 保存時「Could not find the 'valid_to' column of 'local_charges' in the schema cache」
-- 原因: 初期 setup SQL に無かった列（full_name/description/pol/pod/valid_to/source）が未追加
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等・何度実行しても安全）

ALTER TABLE local_charges ADD COLUMN IF NOT EXISTS full_name   text;  -- 正式名称
ALTER TABLE local_charges ADD COLUMN IF NOT EXISTS description text;  -- 解説
ALTER TABLE local_charges ADD COLUMN IF NOT EXISTS pol         text;  -- 積み港（POL）
ALTER TABLE local_charges ADD COLUMN IF NOT EXISTS pod         text;  -- 揚げ港（POD）
ALTER TABLE local_charges ADD COLUMN IF NOT EXISTS valid_to    date;  -- 適用終了日
ALTER TABLE local_charges ADD COLUMN IF NOT EXISTS source      text;  -- 参照元（URL/出典）

-- 旧 port 列のデータを pol へ引き継ぎ（旧スキーマで port を使っていた場合）
UPDATE local_charges SET pol = port
  WHERE pol IS NULL AND port IS NOT NULL;

-- PostgREST のスキーマキャッシュを即時リロード（反映が遅い場合の保険）
NOTIFY pgrst, 'reload schema';
