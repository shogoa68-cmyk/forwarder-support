-- =====================================================================
-- SaaS 化 段階 1-0：核になる定義の書き出し（読み取り専用・SELECT だけ）
-- ---------------------------------------------------------------------
-- 目的：リポジトリに CREATE 文が無い次の 6 つの定義を、いまの Supabase から取り出す。
--   テーブル：quote_presets / allowed_emails / row_patterns
--   関数    ：is_team_member() / get_my_role() / get_my_member_no()
--   あわせて、トリガー・ポリシー（RLS）・保存領域の設定・拡張機能の一覧も取る。
--
-- ★ 安全性：データ（行の中身）は一切読まない。変更もしない（SELECT のみ）。
--   ただし結果の「ポリシー」の中に、メールアドレスが直書きされている場合がある。
--   → 結果は公開リポジトリにコミットしないこと（チャットに貼るのは可）。
--
-- ★ 使い方（今の＝既存チームの Supabase プロジェクトで実行する）：
--   1. Supabase の管理画面 → 左メニュー「SQL Editor」→「New query」
--   2. 下の ① 〜 ⑥ を「1 つずつ」貼り付けて Run（まとめて流すと最後の結果しか出ない）
--   3. 結果は 1 行 1 列（out）の文字列。そのセルをクリックしてコピー
--      （右クリック →「Copy cell」。見切れても全文コピーされる）
--   4. ①〜⑥ の結果を、Claude Code のチャットに順に貼る
--   ※ 存在しないテーブル（例：row_patterns が無い）があっても、エラーにはならず空で返る。
-- =====================================================================


-- ① 列の定義（3 テーブル）
select jsonb_pretty(coalesce(jsonb_agg(to_jsonb(t) order by t.table_name, t.ordinal_position), '[]'::jsonb)) as out
from (
  select table_name, ordinal_position, column_name, data_type, udt_name,
         is_nullable, column_default, is_identity
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('quote_presets', 'allowed_emails', 'row_patterns')
) t;


-- ② 制約と索引（主キー・外部キー・一意・チェック・インデックス）
select jsonb_pretty(jsonb_build_object(
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'table', c.relname, 'name', k.conname, 'def', pg_get_constraintdef(k.oid))
             order by c.relname, k.conname), '[]'::jsonb)
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('quote_presets', 'allowed_emails', 'row_patterns')
  ),
  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'table', tablename, 'name', indexname, 'def', indexdef)
             order by tablename, indexname), '[]'::jsonb)
    from pg_indexes
    where schemaname = 'public'
      and tablename in ('quote_presets', 'allowed_emails', 'row_patterns')
  )
)) as out;


-- ③ 関数（核の 3 つは本文つき／全関数は「名前と SECURITY DEFINER かどうか」だけ）
select jsonb_pretty(jsonb_build_object(
  'core_functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', p.proname,
             'args', pg_get_function_identity_arguments(p.oid),
             'security_definer', p.prosecdef,
             'def', pg_get_functiondef(p.oid))
             order by p.proname), '[]'::jsonb)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('is_team_member', 'get_my_role', 'get_my_member_no')
  ),
  'all_functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', p.proname,
             'args', pg_get_function_identity_arguments(p.oid),
             'secdef', p.prosecdef)
             order by p.proname), '[]'::jsonb)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  )
)) as out;


-- ④ トリガー（3 テーブル）
select jsonb_pretty(coalesce(jsonb_agg(jsonb_build_object(
         'table', c.relname, 'name', t.tgname, 'def', pg_get_triggerdef(t.oid))
         order by c.relname, t.tgname), '[]'::jsonb)) as out
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and c.relname in ('quote_presets', 'allowed_emails', 'row_patterns');


-- ⑤ RLS（行ごとのアクセス制限）
--   rls_by_table＝public の全テーブルで RLS が有効か（false のものは要注意）
--   policies    ＝3 テーブルと、保存領域（storage.objects）のポリシー
select jsonb_pretty(jsonb_build_object(
  'rls_by_table', (
    select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'rls', c.relrowsecurity)
             order by c.relname), '[]'::jsonb)
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'schema', schemaname, 'table', tablename, 'name', policyname,
             'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check)
             order by schemaname, tablename, policyname), '[]'::jsonb)
    from pg_policies
    where (schemaname = 'public' and tablename in ('quote_presets', 'allowed_emails', 'row_patterns'))
       or (schemaname = 'storage' and tablename = 'objects')
  )
)) as out;


-- ⑥ 保存領域（バケット）・拡張機能・リアルタイム配信の対象
select jsonb_pretty(jsonb_build_object(
  'buckets', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'public', public,
             'file_size_limit', file_size_limit,
             'allowed_mime_types', allowed_mime_types) order by id), '[]'::jsonb)
    from storage.buckets
  ),
  'extensions', (
    select coalesce(jsonb_agg(extname order by extname), '[]'::jsonb) from pg_extension
  ),
  'realtime_tables', (
    select coalesce(jsonb_agg(schemaname || '.' || tablename order by tablename), '[]'::jsonb)
    from pg_publication_tables where pubname = 'supabase_realtime'
  )
)) as out;
