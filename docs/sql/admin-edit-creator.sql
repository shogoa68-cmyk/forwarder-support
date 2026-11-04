-- ============================================================
-- 【一時措置】管理者が見積（案件）の「作成者」を変更する
-- ============================================================
-- 作成者（quote_presets.created_by）は通常は変更できない（保存時に書き換えない不変項目）。
-- 担当者の入れ替わりや、他のメンバーが代理で作った案件の付け替えのため、
-- 管理者（get_my_role()='admin'）だけが変更できる RPC を一時的に用意する。
--
-- ・フロント：フォワーダー支援/js/quote/admin-creator-edit.js（ダッシュボードのカードの作成者の横の ✎）
-- ・戻り値：'OK'／'DENIED'（管理者でない・未ログイン）／'NOTFOUND'（案件なし）／'INVALID'（メールが不正）
-- ・更新するのは created_by のみ（owner_email=最終更新者・editors・updated_at・編集ロックは触らない）
--
-- 【この機能をやめるとき】
--   1) Supabase で:  drop function if exists public.quote_admin_set_creator(text, text);
--   2) フォワーダー支援/js/quote/admin-creator-edit.js を削除
--   3) フォワーダー支援/index.html の <script src="js/quote/admin-creator-edit.js"> の 1 行を削除
--   4) フォワーダー支援/js/quote/cloud.js の「adminCreatorEditBtn」「adminApplyCreatorToNew」「cloudIsUnsavedNew」を使う 3 行を削除
--   5) フォワーダー支援/index.html の <div id="adminCreatorNew"> ブロック（新規案件の作成者を指定する欄）を削除
--   6) フォワーダー支援/css/quote.css の「作成者の変更（管理者・一時機能）」ブロックを削除
-- ============================================================
create or replace function public.quote_admin_set_creator(p_id text, p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(public.get_my_role(), 'member') <> 'admin' then
    return 'DENIED';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    return 'INVALID';
  end if;
  update public.quote_presets set created_by = v_email where id::text = p_id;
  if not found then return 'NOTFOUND'; end if;
  return 'OK';
end; $$;

grant execute on function public.quote_admin_set_creator(text, text) to authenticated;
