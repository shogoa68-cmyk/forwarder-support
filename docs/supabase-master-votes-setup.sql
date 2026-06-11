-- 統計タブ: マスター候補投票テーブル
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run

CREATE TABLE IF NOT EXISTS master_votes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  field        text        NOT NULL,          -- 'sv' | 'nm' | 'un'
  value        text        NOT NULL,          -- 投票対象の値
  voter_email  text        NOT NULL,          -- 投票者メール（auth.jwt()->>'email'）
  created_at   timestamptz DEFAULT now(),
  UNIQUE (field, value, voter_email)          -- 1人1票
);

ALTER TABLE master_votes ENABLE ROW LEVEL SECURITY;

-- チームメンバーは全票を閲覧可
CREATE POLICY "team members can read votes" ON master_votes
  FOR SELECT USING (is_team_member());

-- チームメンバーは自分の票を投じられる
CREATE POLICY "team members can insert own votes" ON master_votes
  FOR INSERT WITH CHECK (
    is_team_member()
    AND voter_email = (auth.jwt() ->> 'email')
  );

-- チームメンバーは自分の票だけ取り消せる
CREATE POLICY "team members can delete own votes" ON master_votes
  FOR DELETE USING (
    is_team_member()
    AND voter_email = (auth.jwt() ->> 'email')
  );

CREATE INDEX IF NOT EXISTS idx_master_votes_field_value
  ON master_votes(field, value);
