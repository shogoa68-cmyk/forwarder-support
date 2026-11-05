-- =====================================================================
-- 削除の「ゴミ箱」化・段階 1（案件 quote_presets ＋ 連鎖で消える quote_preset_links）
-- =====================================================================
-- 設計: docs/セキュリティ-削除のゴミ箱化-設計案.md
--
-- しくみ（画面のコードは変えない）:
--   案件が削除される「直前」に、トリガーが行の中身をまるごと public.trash へコピーする。
--   読む側（一覧・統計・類似見積など）は今までどおり。どこから消しても控えが残る。
--   控えの保存に失敗したときは、削除ごと取り消される（控えが無いまま消えることはない）。
--
-- 決定事項（2026-11-05）:
--   ・保存期間 30 日（expires_at。過ぎた控えは毎日の掃除で完全に消える）
--   ・戻せる人 = チームメンバー全員 ／ 完全に消せる人 = 管理者のみ
--   ・最初の対象 = quote_presets と quote_preset_links だけ
--
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何回流しても同じ結果）。
--   ※ 先に「確認用のデータベース」で scripts/design-tests/trash-sql-test.sh を通すこと。
--
-- 前提:
--   ・public.quote_presets / public.is_team_member() / public.get_my_role() が存在すること
--   ・public.quote_preset_links があれば同じゴミ箱の対象にする（無ければ飛ばす）
--   ・pg_cron が使えること（無ければ掃除の予約だけ飛ばして NOTICE を出す）
--
-- 元に戻したいとき（やめるとき）:
--   drop trigger trg_trash_quote_presets on public.quote_presets;
--   drop trigger trg_trash_quote_preset_links on public.quote_preset_links;
--   ※ trash テーブルは残る（中身は期限が来れば消える）。
--
-- できないこと（意図して対象外）:
--   ・truncate（全件消し）は拾えない（アプリは使っていない）
--   ・Storage の添付ファイルの実体は守れない（案件の添付は 14 日で自動削除）
--   ・管理者が悪意を持って空にする場合は防げない（持ち出し対策は別の段階）
-- =====================================================================

-- ① ゴミ箱テーブル（全テーブル分をこの 1 つにまとめる。段階 2 以降も使い回す）
create table if not exists public.trash (
  id            uuid primary key default gen_random_uuid(),
  source_table  text        not null,                         -- 元のテーブル名
  source_id     text        not null,                         -- 元の行の id
  label         text        not null default '',              -- 一覧に出す名前（案件名など）
  row_data      jsonb       not null,                         -- 消えた行の中身まるごと
  batch_id      bigint,                                       -- 同じ削除（トランザクション）の目印
  deleted_by    text,                                         -- 消した人のメール
  deleted_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days',
  restored_at   timestamptz,                                  -- 戻した日時（戻したら印を付ける）
  restored_by   text
);
create index if not exists idx_trash_active  on public.trash (deleted_at desc) where restored_at is null;
create index if not exists idx_trash_source  on public.trash (source_table, source_id);
create index if not exists idx_trash_expires on public.trash (expires_at);

-- 見える範囲は元のデータと同じ（チームメンバーのみ）。書き込みはトリガーと関数だけ。
alter table public.trash enable row level security;
revoke all on public.trash from anon, authenticated;
grant select on public.trash to authenticated;
drop policy if exists "team read trash" on public.trash;
create policy "team read trash" on public.trash
  for select to authenticated using (public.is_team_member());

-- ② 削除の直前に控えを取るトリガー関数（1 つを全テーブルで使い回す）
--    失敗すると例外になり、削除そのものが取り消される（決定: 削除を止める）。
create or replace function public.trash_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare j jsonb := to_jsonb(old);
begin
  insert into public.trash (source_table, source_id, label, row_data, batch_id, deleted_by)
  values (tg_table_name,
          j->>'id',
          coalesce(nullif(j->>'name', ''), nullif(j->>'note', ''), ''),
          j,
          txid_current(),
          coalesce(auth.email(), session_user));
  return old;
end; $$;
revoke all on function public.trash_on_delete() from public, anon, authenticated;

-- ③ 対象テーブルに取り付ける（編集ロックの RLS で弾かれた行は「削除されない」ので控えも作られない）
drop trigger if exists trg_trash_quote_presets on public.quote_presets;
create trigger trg_trash_quote_presets
  before delete on public.quote_presets
  for each row execute function public.trash_on_delete();

do $$ begin
  if to_regclass('public.quote_preset_links') is not null then
    execute 'drop trigger if exists trg_trash_quote_preset_links on public.quote_preset_links';
    execute 'create trigger trg_trash_quote_preset_links before delete on public.quote_preset_links
             for each row execute function public.trash_on_delete()';
  else
    raise notice 'quote_preset_links が無いので、リンクのゴミ箱は飛ばしました';
  end if;
end $$;

-- ④ 元に戻す（チームメンバー全員）
--    戻り値(jsonb): status = OK / DENIED / NOTFOUND / ALREADY / EXPIRED / CONFLICT / PARENT_MISSING / UNSUPPORTED
--    ・案件を戻すと、ゴミ箱にある「その案件のリンク」も、相手の案件が今あれば一緒に戻る
--    ・編集ロック（locked_by など）は空にして戻す
--    ・同じ id の行が今あるなどで戻せないときは CONFLICT を返し、何も変えない
create or replace function public.trash_restore(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t      public.trash%rowtype;
  l      public.trash%rowtype;
  me     text := coalesce(auth.email(), session_user);
  strip  text[] := array['locked_by', 'locked_at', 'force_released_from', 'force_released_at'];
  n_ok   int := 0;
  n_skip int := 0;
begin
  if not coalesce(public.is_team_member(), false) then
    return jsonb_build_object('status', 'DENIED');
  end if;

  select * into t from public.trash where id = p_id for update;
  if not found then return jsonb_build_object('status', 'NOTFOUND'); end if;
  if t.restored_at is not null then return jsonb_build_object('status', 'ALREADY'); end if;
  if t.expires_at < now() then return jsonb_build_object('status', 'EXPIRED'); end if;

  begin
    if t.source_table = 'quote_presets' then
      insert into public.quote_presets
        select * from jsonb_populate_record(null::public.quote_presets, t.row_data - strip);
      update public.trash set restored_at = now(), restored_by = me where id = t.id;
      n_ok := n_ok + 1;

      -- この案件につながるリンク（ゴミ箱にあるもの）を、相手の案件が今あれば一緒に戻す
      for l in
        select * from public.trash
         where source_table = 'quote_preset_links'
           and restored_at is null and expires_at >= now()
           and (row_data->>'preset_a' = t.source_id or row_data->>'preset_b' = t.source_id)
         order by deleted_at for update
      loop
        begin
          insert into public.quote_preset_links
            select * from jsonb_populate_record(null::public.quote_preset_links, l.row_data);
          update public.trash set restored_at = now(), restored_by = me where id = l.id;
          n_ok := n_ok + 1;
        exception when foreign_key_violation or unique_violation then
          n_skip := n_skip + 1;       -- 相手の案件がまだ無い等。リンクはゴミ箱に残す
        end;
      end loop;

    elsif t.source_table = 'quote_preset_links' then
      begin
        insert into public.quote_preset_links
          select * from jsonb_populate_record(null::public.quote_preset_links, t.row_data);
      exception when foreign_key_violation then
        return jsonb_build_object('status', 'PARENT_MISSING');
      end;
      update public.trash set restored_at = now(), restored_by = me where id = t.id;
      n_ok := n_ok + 1;

    else
      return jsonb_build_object('status', 'UNSUPPORTED');
    end if;
  exception when unique_violation then
    return jsonb_build_object('status', 'CONFLICT');   -- ここまでの変更は取り消される
  end;

  return jsonb_build_object('status', 'OK', 'restored', n_ok, 'skipped', n_skip,
                            'source_table', t.source_table, 'source_id', t.source_id, 'label', t.label);
end; $$;

-- ⑤ 完全に消す（管理者のみ）。案件なら、その案件のリンクの控えも一緒に消す
create or replace function public.trash_purge(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare t public.trash%rowtype;
begin
  if coalesce(public.get_my_role(), 'member') <> 'admin' then return 'DENIED'; end if;
  select * into t from public.trash where id = p_id for update;
  if not found then return 'NOTFOUND'; end if;
  if t.source_table = 'quote_presets' then
    delete from public.trash
     where source_table = 'quote_preset_links' and restored_at is null
       and (row_data->>'preset_a' = t.source_id or row_data->>'preset_b' = t.source_id);
  end if;
  delete from public.trash where id = t.id;
  return 'OK';
end; $$;

-- ⑥ 期限切れの掃除（毎日。画面からは呼べない）
create or replace function public.purge_expired_trash()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.trash where expires_at < now();
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.purge_expired_trash() from public, anon, authenticated;

-- ⑦ 関数の実行権限（画面から呼べるのは、戻す・完全に消すの 2 つだけ）
revoke all on function public.trash_restore(uuid) from public, anon;
revoke all on function public.trash_purge(uuid)   from public, anon;
grant execute on function public.trash_restore(uuid) to authenticated;
grant execute on function public.trash_purge(uuid)   to authenticated;

-- ⑧ 毎日の掃除を予約（不具合報告の添付の掃除と同じ pg_cron）
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'purge-expired-trash';
  perform cron.schedule('purge-expired-trash', '20 18 * * *', 'select public.purge_expired_trash();');
exception when others then
  raise notice 'pg_cron が使えないため、掃除の予約を飛ばしました（%）。ダッシュボードで手動予約してください', sqlerrm;
end $$;
