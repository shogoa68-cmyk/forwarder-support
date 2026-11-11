-- マスターの変更履歴（追記のみ・書き換え不可）【案・まだ Supabase では実行していない】
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
--
-- 設計思想: docs/設計思想-共同で育てる知識.md（③改ざん耐性 ④透明性）の最初の一歩。
--
-- 前提: is_team_member()（チームメンバー判定）が作成済みであること
--
-- 何をするか
--   ・マスター関連の表（master_votes／synonym_groups／master_details／master_attachments／master_requests／alias_rules）
--     への「追加・変更・削除」を、変更前と変更後の中身つきで master_history に自動で記録する
--   ・記録は DB のトリガーが行う。アプリ側（JS）は 1 行も変えない。保存・承認制・投票の動きも変わらない
--   ・履歴は追記のみ。アプリからも、DB の持ち主・service_role からも、書き換え・削除・TRUNCATE はできない（トリガーで拒否）
--   ・実行した時点の既存データを「BASELINE（出発点）」として 1 回だけ記録する（以降の変更の比較元になる）
--   ・削除された名前も old_data に中身が残るため、あとから「いつ・誰が消したか」と元の中身が分かる（＝削除の無効化に近い）
--
-- 変わらないこと
--   ・既存の表・列・ポリシー・アプリの動作（表が無い環境では、その表のトリガーを作らないだけ）
--
-- できないこと（正直な限界）
--   ・Supabase の持ち主（postgres・ダッシュボードの管理者）がトリガーを無効化・削除すれば、履歴は止められる。
--     それを検知する仕組み（各行に前の行の指紋＝ハッシュを持たせる鎖）は、この段階では入れていない（必要になったら追加）

-- ===== 履歴テーブル =====
create table if not exists public.master_history (
  id           bigint      generated always as identity primary key,
  changed_at   timestamptz not null default now(),
  changed_by   text,                                    -- 実行者のメール（ログイン中のユーザー）。DB から直接の操作は 'system:<ロール名>'
  source_table text        not null,                    -- 'master_votes' / 'synonym_groups' / 'master_details' / 'master_attachments' / 'master_requests' / 'alias_rules'
  action       text        not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'BASELINE')),
  field        text,                                    -- マスターの種別（'customer' / 'sv' / 'nm' / 'port' / 'un' / 'carrier'）
  value        text,                                    -- マスターの名前（synonym_groups は代表名 canonical）
  row_id       text,                                    -- 元の行の id
  old_data     jsonb,                                   -- 変更前（INSERT・BASELINE は null）
  new_data     jsonb                                    -- 変更後（DELETE は null）
);

create index if not exists idx_master_history_target on public.master_history (field, value, changed_at desc);
create index if not exists idx_master_history_time   on public.master_history (changed_at desc);
create index if not exists idx_master_history_by     on public.master_history (changed_by, changed_at desc);

-- ===== 閲覧はチームメンバー全員・書き込みはトリガーだけ =====
alter table public.master_history enable row level security;

revoke all on public.master_history from public, anon, authenticated;
grant select on public.master_history to authenticated;

drop policy if exists "team members can read master history" on public.master_history;
create policy "team members can read master history" on public.master_history
  for select using (is_team_member());
-- insert / update / delete のポリシーは作らない（アプリからは書けない）

-- ===== 書き換え・削除の拒否（持ち主・service_role も含めて）=====
create or replace function public.master_history_deny_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'master_history は追記のみです（% は許可されていません）', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists trg_master_history_no_row_change on public.master_history;
create trigger trg_master_history_no_row_change
  before update or delete on public.master_history
  for each row execute function public.master_history_deny_change();

drop trigger if exists trg_master_history_no_truncate on public.master_history;
create trigger trg_master_history_no_truncate
  before truncate on public.master_history
  for each statement execute function public.master_history_deny_change();

-- ===== 変更の自動記録 =====
create or replace function public.log_master_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_by  text  := coalesce(nullif(auth.jwt() ->> 'email', ''), 'system:' || session_user);
begin
  -- 更新日時だけが変わった更新（実質の変更なし）は記録しない
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  insert into public.master_history (changed_by, source_table, action, field, value, row_id, old_data, new_data)
  values (
    v_by, tg_table_name, tg_op,
    v_row ->> 'field',
    coalesce(v_row ->> 'value', v_row ->> 'canonical'),
    v_row ->> 'id',
    v_old, v_new
  );

  return coalesce(new, old);
end;
$$;

revoke all on function public.log_master_change() from public, anon, authenticated;

-- ===== 対象の表にトリガーを付け、現在の中身を出発点として 1 回だけ記録 =====
-- 表が無い環境（まだ SQL を実行していない機能）はそのまま飛ばす
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['master_votes', 'synonym_groups', 'master_details', 'master_attachments', 'master_requests', 'alias_rules']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip %（表がありません）', t;
      continue;
    end if;

    execute format('drop trigger if exists trg_master_history on public.%I', t);
    execute format(
      'create trigger trg_master_history after insert or update or delete on public.%I
         for each row execute function public.log_master_change()', t);

    -- 出発点の記録は表ごとに 1 回だけ。「記録済み」の目印の行（row_id が空の BASELINE）で判定する
    -- （表が空だった場合も目印は残るので、あとから流し直しても重複しない）
    if not exists (
      select 1 from public.master_history
       where source_table = t and action = 'BASELINE' and row_id is null
    ) then
      execute format(
        $q$insert into public.master_history (changed_by, source_table, action, field, value, row_id, new_data)
           select 'system:baseline', %L, 'BASELINE',
                  to_jsonb(x) ->> 'field',
                  coalesce(to_jsonb(x) ->> 'value', to_jsonb(x) ->> 'canonical'),
                  to_jsonb(x) ->> 'id',
                  to_jsonb(x)
           from public.%I x$q$, t, t);
      get diagnostics n = row_count;
      insert into public.master_history (changed_by, source_table, action, new_data)
      values ('system:baseline', t, 'BASELINE', jsonb_build_object('baseline_rows', n));
    end if;
  end loop;
end $$;

-- =====================================================================
-- 動作確認（任意）：
--   -- 直近の履歴
--   select changed_at, changed_by, source_table, action, field, value
--     from public.master_history order by id desc limit 10;
--   -- ある名前の経緯（例：お客様「○○」）
--   select changed_at, changed_by, action, old_data, new_data
--     from public.master_history where field = 'customer' and value = '○○' order by id;
-- =====================================================================
