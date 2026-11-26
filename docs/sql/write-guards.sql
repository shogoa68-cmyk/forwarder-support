-- ============================================================
-- 書き込みの守り（2026-11・QA で見つかった 2 件）
-- ============================================================
-- ① 案件（quote_presets）の編集ロック・作成者を、画面や REST から直接書き換えられないようにする。
--    いままで lock_guard_update は「更新前の行」しか見ていなかったため、空いている案件なら
--      update quote_presets set locked_by='他人', locked_at='2099-01-01' …
--    のようにロックを他人の名前・遠い未来の時刻で書き込めた（90 秒で失効せず、管理者が解放するまで誰も編集できない）。
--    created_by（作成者）も書き換えられ、管理者専用の quote_admin_set_creator を素通りできた。
--    → BEFORE トリガーで、直接の書き込み（ロール authenticated／anon）のときは
--      locked_by・locked_at・force_released_from／at・created_by を「元の値のまま」に戻す。
--      新しく作るときは、ロックは空・作成者は書いた本人（auth.email()）に決める。
--      ロックの取得・更新・解放、管理者の強制解放、作成者の付け替えは、いままでどおり
--      security definer の関数（quote_acquire_lock ほか）から行う（関数の中は関数の持ち主の権限で動くので、このトリガーは素通り）。
--
-- ② 「閲覧のみ」（allowed_emails.role = 'viewer'）のメンバーは、画面で止めているだけで、
--    開発者ツールや REST からは案件・取引ルール・カルテ・ニュース・ブックマーク・カレンダー・進行などを
--    書き換え・削除できた。→ チームのデータの表に「閲覧のみは書けない」制限のポリシー（restrictive）を重ねる。
--    いまの「メンバーなら書ける」ポリシーは変えず、AND で重ねるだけ。表が無いものは飛ばす。
--    閲覧のみでも書けるもの（対象外）：不具合報告・アイデア（feedbacks／feedback_comments／feedback_votes）、
--    自分のプロフィール（user_profiles）、自分の作業フォルダ（wf_nodes）、ブックマークのクリック記録（bookmark_clicks）、
--    変更履歴（*_history＝トリガーが書く）、メール取込の記録（RPC 経由）。
--
-- requires: is_team_member()・get_my_role()（Supabase Dashboard で作成済み）・auth.email()
-- 何度流しても安全（冪等）。元に戻すときは末尾の「元に戻す」を参照。
-- ============================================================

-- ---------- ① 案件のロック・作成者 ----------
create or replace function public.quote_presets_write_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- security definer の関数（ロックの取得・強制解放・作成者の付け替え）や管理用の操作は持ち主の権限で動くので触らない
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.locked_by := null;
    new.locked_at := null;
    new.force_released_from := null;
    new.force_released_at := null;
    new.created_by := coalesce(nullif(auth.email(), ''), new.created_by);
  else
    new.locked_by := old.locked_by;
    new.locked_at := old.locked_at;
    new.force_released_from := old.force_released_from;
    new.force_released_at := old.force_released_at;
    new.created_by := old.created_by;
  end if;
  return new;
end; $$;

drop trigger if exists quote_presets_write_guard on public.quote_presets;
create trigger quote_presets_write_guard
  before insert or update on public.quote_presets
  for each row execute function public.quote_presets_write_guard();

-- ロックの取得も「閲覧のみ」には許さない（編集しないので不要）
create or replace function public.quote_acquire_lock(p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare cur_by text; cur_at timestamptz; fr_from text; fr_at timestamptz;
begin
  if not is_team_member() then return 'DENIED'; end if;
  if coalesce(public.get_my_role(), 'member') = 'viewer' then return 'DENIED'; end if;
  select locked_by, locked_at, force_released_from, force_released_at
    into cur_by, cur_at, fr_from, fr_at
    from public.quote_presets where id::text = p_id for update;
  if not found then return 'NOTFOUND'; end if;
  if cur_by is null and fr_from is not null and fr_from = auth.email()
     and fr_at is not null and fr_at > now() - interval '60 seconds' then
    return 'COOLDOWN';
  end if;
  if cur_by is null or cur_by = auth.email() or cur_at < now() - interval '90 seconds' then
    update public.quote_presets
      set locked_by = auth.email(), locked_at = now(),
          force_released_from = null, force_released_at = null
      where id::text = p_id;
    return 'OK';
  else
    return cur_by;
  end if;
end; $$;
grant execute on function public.quote_acquire_lock(text) to authenticated;

-- ---------- ② 閲覧のみは書けない ----------
-- 書けるのは「チームのメンバー」かつ「閲覧のみでない」人
create or replace function public.can_write_team_data()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return public.is_team_member() and coalesce(public.get_my_role(), 'member') <> 'viewer';
end; $$;
grant execute on function public.can_write_team_data() to authenticated, anon;

do $$
declare
  t text;
  tables text[] := array[
    'quote_presets', 'quote_preset_links', 'quote_comments', 'quote_attachments', 'quote_temp_files',
    'bookmarks', 'bookmark_verifications', 'carrier_contacts', 'carrier_relations',
    'calendar_holidays', 'calendar_surcharges',
    'customer_rules', 'customer_cases', 'master_news', 'master_votes', 'master_details', 'master_attachments',
    'master_requests', 'synonym_groups', 'alias_rules', 'stats_exclusions', 'drift_log',
    'remark_presets', 'remark_preset_verifications', 'row_patterns', 'translation_dict',
    'ops_jobs', 'ops_guides', 'ops_notes', 'ops_files', 'cp_watch_targets', 'email_rule_proposals'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "viewer_readonly_insert" on public.%I', t);
    execute format('create policy "viewer_readonly_insert" on public.%I as restrictive for insert to authenticated with check (public.can_write_team_data())', t);
    execute format('drop policy if exists "viewer_readonly_update" on public.%I', t);
    execute format('create policy "viewer_readonly_update" on public.%I as restrictive for update to authenticated using (public.can_write_team_data()) with check (public.can_write_team_data())', t);
    execute format('drop policy if exists "viewer_readonly_delete" on public.%I', t);
    execute format('create policy "viewer_readonly_delete" on public.%I as restrictive for delete to authenticated using (public.can_write_team_data())', t);
  end loop;
end $$;

-- ============================================================
-- 元に戻す（必要なときだけ）
--   drop trigger if exists quote_presets_write_guard on public.quote_presets;
--   do $$ declare t text; begin
--     for t in select tablename from pg_policies where schemaname='public' and policyname like 'viewer_readonly_%' group by tablename loop
--       execute format('drop policy if exists "viewer_readonly_insert" on public.%I', t);
--       execute format('drop policy if exists "viewer_readonly_update" on public.%I', t);
--       execute format('drop policy if exists "viewer_readonly_delete" on public.%I', t);
--     end loop; end $$;
-- ============================================================
