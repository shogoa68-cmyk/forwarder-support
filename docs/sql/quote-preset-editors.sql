-- =====================================================================
-- quote_presets：更新者の履歴（editors）をトリガーで自動記録
-- =====================================================================
-- 目的：
--   ・案件カードで「作成者（1名）」と「更新した人（複数）」を管理できるようにする。
--   ・created_by（作成者）は既に保持しているが、更新は owner_email＝最終更新者の
--     1名分しか残らず、途中で誰が触ったかが分からなかった。
--
-- 方式：
--   ・editors jsonb 列に [{ email, at, count }, ...] を新しい順で保持する。
--   ・アプリ側の保存処理に依存せず、BEFORE INSERT/UPDATE トリガーで自動更新する。
--     （ダッシュボードのステータス変更など、どの経路の更新でも取りこぼさない）
--   ・編集ロック（locked_by/locked_at）や Presence だけの更新では加算しない。
--     data と status のどちらも変わっていない UPDATE は「編集ではない」とみなす。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run。
--   （何度流しても安全なように IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS で冪等化）
--
-- 前提：
--   ・既存テーブル public.quote_presets が存在すること
-- =====================================================================

-- 1) editors 列 -------------------------------------------------------
alter table public.quote_presets
  add column if not exists editors jsonb not null default '[]'::jsonb;

comment on column public.quote_presets.editors is
  '更新した人の履歴。[{email, at, count}, ...] を新しい順で最大20件保持（トリガーが自動更新）';

-- 2) 既存案件の初期化 -------------------------------------------------
-- 過去の更新者は残っていないため、分かる範囲（最終更新者→作成者）だけ入れておく。
-- 以降の更新からはトリガーが正しく積み上げる。
update public.quote_presets
set editors = (
  case
    when owner_email is null and created_by is null then '[]'::jsonb
    when owner_email is null or owner_email = created_by then
      jsonb_build_array(jsonb_build_object(
        'email', coalesce(owner_email, created_by),
        'at',    to_char(coalesce(updated_at, now()) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'count', 1))
    when created_by is null then
      jsonb_build_array(jsonb_build_object(
        'email', owner_email,
        'at',    to_char(coalesce(updated_at, now()) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'count', 1))
    else
      jsonb_build_array(
        jsonb_build_object(
          'email', owner_email,
          'at',    to_char(coalesce(updated_at, now()) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'count', 1),
        jsonb_build_object(
          'email', created_by,
          'at',    to_char(coalesce(updated_at, now()) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'count', 1))
  end
)
where editors is null or editors = '[]'::jsonb;

-- 3) 更新者を積むトリガー関数 -----------------------------------------
create or replace function public.bump_quote_preset_editors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  max_keep constant int := 20;   -- 保持件数の上限（古いものから捨てる）
  who   text;
  prev  jsonb;
  mine  jsonb;
  rest  jsonb;
  merged jsonb;
begin
  prev := coalesce(case when tg_op = 'UPDATE' then old.editors else null end, '[]'::jsonb);

  -- ロック取得/解放や Presence だけの更新は「編集」に数えない
  if tg_op = 'UPDATE'
     and new.data   is not distinct from old.data
     and new.status is not distinct from old.status then
    new.editors := prev;
    return new;
  end if;

  -- 実行者：JWT のメールを優先し、取れなければアプリが入れた owner_email を使う
  who := coalesce(nullif(auth.jwt() ->> 'email', ''), new.owner_email);
  if who is null then
    new.editors := prev;
    return new;
  end if;

  -- 同じ人の既存エントリ（回数を引き継ぐ）
  select e into mine
  from jsonb_array_elements(prev) e
  where e ->> 'email' = who
  limit 1;

  -- 自分以外は順序を保ったまま残す
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into rest
  from jsonb_array_elements(prev) with ordinality t(e, ord)
  where e ->> 'email' is distinct from who;

  merged := jsonb_build_array(jsonb_build_object(
      'email', who,
      'at',    to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'count', coalesce((mine ->> 'count')::int, 0) + 1
    )) || rest;

  if jsonb_array_length(merged) > max_keep then
    select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into merged
    from jsonb_array_elements(merged) with ordinality t(e, ord)
    where ord <= max_keep;
  end if;

  new.editors := merged;
  return new;
end $$;

-- 4) トリガー ---------------------------------------------------------
drop trigger if exists trg_quote_presets_editors on public.quote_presets;
create trigger trg_quote_presets_editors
  before insert or update on public.quote_presets
  for each row execute function public.bump_quote_preset_editors();
