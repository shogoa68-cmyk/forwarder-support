-- 全体リマーク・免責事項タブ：チーム共有プリセット（remark_presets）
-- 「☁️ チーム共有」欄のボタン群（js/quote/ui.js の loadSharedRemarkPresets /
-- addSharedRemarkPreset / deleteSharedRemarkPreset / _incrementSharedRemarkUseCount）が
-- 参照するテーブル。このテーブルが無い状態でも UI 自体は表示される（ログイン時のみ）が、
-- 「☁️ 共有に追加」を押すと「relation "remark_presets" does not exist」等のエラーで失敗する。
--
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run
--   ※ ファイル全体を何度実行しても安全（冪等）。
--
-- 「＋ 個人に追加」（USER_REMARK_PRESETS_KEY・localStorage）はこのテーブルとは別物で、
-- そのブラウザだけに保存される個人用プリセット。チームで共有したい文言はこちらではなく
-- 「☁️ 共有に追加」を使う（use_count が 5 件以上たまると自動的に「チーム人気 ⭐」へ昇格する）。

CREATE TABLE IF NOT EXISTS remark_presets (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text        NOT NULL,   -- チップの表示ラベル（例：📄 特別条件）
  text       text        NOT NULL,   -- 挿入される本文
  use_count  integer     NOT NULL DEFAULT 0,  -- 5以上で「チーム人気 ⭐」へ自動昇格
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE remark_presets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "team members can read remark_presets" ON remark_presets;
CREATE POLICY "team members can read remark_presets" ON remark_presets
  FOR SELECT USING (is_team_member());

DROP POLICY IF EXISTS "team members can insert remark_presets" ON remark_presets;
CREATE POLICY "team members can insert remark_presets" ON remark_presets
  FOR INSERT WITH CHECK (is_team_member());

DROP POLICY IF EXISTS "team members can update remark_presets" ON remark_presets;
CREATE POLICY "team members can update remark_presets" ON remark_presets
  FOR UPDATE USING (is_team_member()) WITH CHECK (is_team_member());

DROP POLICY IF EXISTS "team members can delete remark_presets" ON remark_presets;
CREATE POLICY "team members can delete remark_presets" ON remark_presets
  FOR DELETE USING (is_team_member());

CREATE INDEX IF NOT EXISTS idx_remark_presets_use_count ON remark_presets(use_count DESC);
