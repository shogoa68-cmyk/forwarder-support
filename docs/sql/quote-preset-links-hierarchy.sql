-- =====================================================================
-- quote_preset_links に「メイン／サブ」の向きを足す（関連付けた案件を入れ子・ツリーで見せるため）
-- =====================================================================
-- 目的：
--   これまでの関連付け（quote_preset_links）は「A と B をつなぐ」だけの対称な 1 行で、
--   どちらが主でどちらが従かを持たなかった。ある案件を「メイン」、追加の案件を「サブ」として
--   ぶら下げ、ダッシュボードなどでツリー（入れ子）表示できるようにする。
--
-- 仕組み：
--   parent_id＝この関連付けの「メイン」側の案件 ID（preset_a か preset_b のどちらか）。
--   もう片方がそのメインの「サブ」。parent_id が NULL の行は従来どおりの「ただの関連付け」
--   （既存データはすべてこれ＝見え方は変わらない）。
--   1 つのサブに付けられるメインは 1 つ（ツリーにするため）。この制約と、メイン⇄サブの循環の
--   禁止は画面側（cloud.js）で確認している（DB の制約は「parent_id が a/b のどちらか」まで）。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run（冪等・何度実行しても安全）。
--
-- 前提：
--   ・docs/sql/quote-preset-links.sql を実行済み（public.quote_preset_links が存在すること）
--
-- 未実行でも動く：
--   列が無い間は「メイン／サブ」を選べない（選ぶと案内が出る）だけで、関連付け自体は従来どおり使える。
-- =====================================================================

alter table public.quote_preset_links
  add column if not exists parent_id uuid references public.quote_presets(id) on delete set null;

-- parent_id は、その行の 2 案件のどちらか（メイン側）でなければならない
alter table public.quote_preset_links drop constraint if exists quote_preset_links_parent_ck;
alter table public.quote_preset_links
  add constraint quote_preset_links_parent_ck
  check (parent_id is null or parent_id = preset_a or parent_id = preset_b);

-- 「このメインにぶら下がるサブ」を引く索引（ダッシュボードのツリー取得で使う）
create index if not exists idx_quote_preset_links_parent on public.quote_preset_links (parent_id)
  where parent_id is not null;
