-- エイリアス是正の対象に「お客様(customer)」を追加するためのマイグレーション。
-- 既存の alias_rules テーブルの field CHECK 制約に 'customer' を許可する。
-- Supabase の SQL Editor で1回実行してください（実行前でもローカル保存・ローカル適用は動作します）。
ALTER TABLE alias_rules DROP CONSTRAINT IF EXISTS alias_rules_field_check;
ALTER TABLE alias_rules
  ADD CONSTRAINT alias_rules_field_check
  CHECK (field IN ('sv', 'nm', 'un', 'port', 'carrier', 'customer'));
