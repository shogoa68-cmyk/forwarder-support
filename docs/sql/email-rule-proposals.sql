-- ============================================================
-- 🤖 メール取込：サブコン別の読み取りルールを「AI が提案し、人が採用する」ための仕組み
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：docs/sql/email-import-unread.sql と docs/sql/email-import-feedback.sql を先に実行済みであること。
--       email-import-feedback.sql をあとでもう一度流したときは、このファイルももう一度流すこと
--       （読み取り口 email_import_export をこのファイルの版に置き換えるため）。
-- 未実行でもアプリは動く（提案の欄が出ないだけ）。
--
-- 流れ：
--   ① 確認画面の評価・直し（email_import_feedback）に、サブコン名（sv）も付けて記録する
--      （チームの Supabase の中だけ。公開リポジトリには書き出さない）
--   ② 週 1 回の作業（AI）が、読み取り口からサブコンごとの記録と今のルールを読み、
--      email_rule_propose(合言葉, 提案) で「提案」だけを書き込む（ルールそのものは書き換えない）
--   ③ 画面（マスター管理のサブコン詳細「メール取込ルール」・サブコン専用の取込）に提案が出て、
--      人が［採用］するとルールに入る／［却下］すると同じ提案は二度と出ない（email_rule_decide）
-- ============================================================

-- ---- ① 評価の記録にサブコン名を付ける ----
alter table public.email_import_feedback add column if not exists sv text not null default '';
do $$
declare pk text;
begin
  select string_agg(a.attname, ',' order by a.attnum) into pk
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
   where i.indrelid = 'public.email_import_feedback'::regclass and i.indisprimary;
  if pk is null or position('sv' in pk) = 0 then
    if pk is not null then alter table public.email_import_feedback drop constraint email_import_feedback_pkey; end if;
    alter table public.email_import_feedback add constraint email_import_feedback_pkey primary key (kind, shape, hint, sv);
  end if;
end $$;
create index if not exists email_import_feedback_sv_idx on public.email_import_feedback (sv, last_seen desc);

-- 記録の入口（置き換え）：items = [{"kind":"ok|ignore|fix","shape":"…","hint":"…","sv":"サブコン名（任意）"}]
create or replace function public.email_feedback_record(items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb; k text; s text; h text; v text; n integer := 0;
begin
  if not is_team_member() then return 0; end if;
  if jsonb_typeof(coalesce(items, 'null'::jsonb)) <> 'array' then return 0; end if;
  for it in select * from jsonb_array_elements(items) loop
    exit when n >= 20;
    if jsonb_typeof(it) <> 'object' then continue; end if;
    k := it ->> 'kind';
    s := btrim(regexp_replace(coalesce(it ->> 'shape', ''), '\s+', ' ', 'g'));
    h := btrim(regexp_replace(coalesce(it ->> 'hint', ''), '\s+', ' ', 'g'));
    v := btrim(regexp_replace(coalesce(it ->> 'sv', ''), '\s+', ' ', 'g'));
    if k in ('ok', 'ignore', 'fix')
       and length(s) between 3 and 160
       and length(h) <= 160
       and length(v) <= 80
       and (s || h) !~ '[0-8０-８]'
       and (s || h || v) !~ '@'
       and (s || h || v) !~* 'https?://' then
      insert into public.email_import_feedback (kind, shape, hint, sv) values (k, s, h, v)
      on conflict (kind, shape, hint, sv) do update
        set seen_count = public.email_import_feedback.seen_count + 1,
            last_seen  = now(),
            status     = case when public.email_import_feedback.status = 'handled' then 'new' else public.email_import_feedback.status end;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.email_feedback_record(jsonb) from public, anon;
grant execute on function public.email_feedback_record(jsonb) to authenticated;

-- 合言葉の確かめ（中で使うだけ。外からは呼べない）
create or replace function public.email_export_token_ok(p_token text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select token = p_token and length(token) >= 32 and token not like '<%' from public.email_export_keys where id = 1), false)
$$;
revoke all on function public.email_export_token_ok(text) from public, anon, authenticated;

-- ---- ② 提案の置き場所 ----
create table if not exists public.email_rule_proposals (
  id          bigserial primary key,
  sv          text not null,                                   -- サブコンの代表名
  kind        text not null check (kind in ('alias', 'ignore', 'ccy', 'unit', 'qty_as_unit')),
  key         text not null,                                   -- 同じ提案を二度出さないための目印
  payload     jsonb not null,                                  -- alias={from,to,cat,unit}／ignore={shape}／ccy={ccy}／unit={unit}／qty_as_unit={on}
  reason      text not null default '',                        -- 提案の理由（件数など。記録の文そのものは書かない）
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_by  text,
  decided_at  timestamptz,
  unique (sv, kind, key)
);
create index if not exists email_rule_proposals_sv_idx on public.email_rule_proposals (sv, status);
alter table public.email_rule_proposals enable row level security;
revoke all on public.email_rule_proposals from anon;
revoke insert, update, delete on public.email_rule_proposals from authenticated;
grant select on public.email_rule_proposals to authenticated;
drop policy if exists "erp select" on public.email_rule_proposals;
create policy "erp select" on public.email_rule_proposals for select to authenticated using (is_team_member());

-- AI が提案を書き込む入口（合言葉が必要・提案の表にだけ書ける・1 回に最大 50 件・同じ提案は重ねない＝却下済みも復活しない）
create or replace function public.email_rule_propose(p_token text, items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb; v text; k text; p jsonb; kk text; pl jsonb; r text; n integer := 0;
begin
  if not email_export_token_ok(p_token) then return 0; end if;
  if jsonb_typeof(coalesce(items, 'null'::jsonb)) <> 'array' then return 0; end if;
  for it in select * from jsonb_array_elements(items) loop
    exit when n >= 50;
    if jsonb_typeof(it) <> 'object' then continue; end if;
    v := btrim(coalesce(it ->> 'sv', ''));
    k := it ->> 'kind';
    p := coalesce(it -> 'payload', '{}'::jsonb);
    r := left(btrim(coalesce(it ->> 'reason', '')), 200);
    if v = '' or length(v) > 80 or jsonb_typeof(p) <> 'object' then continue; end if;
    if (v || r || p::text) ~ '@' or (v || r || p::text) ~* 'https?://' then continue; end if;
    kk := null; pl := null;
    if k = 'alias' then
      if coalesce(btrim(p ->> 'from'), '') <> '' and coalesce(btrim(p ->> 'to'), '') <> ''
         and length(p ->> 'from') <= 80 and length(p ->> 'to') <= 80
         and length(coalesce(p ->> 'cat', '')) <= 40 and length(coalesce(p ->> 'unit', '')) <= 20 then
        kk := lower(regexp_replace(p ->> 'from', '\s', '', 'g'));
        pl := jsonb_build_object('from', btrim(p ->> 'from'), 'to', btrim(p ->> 'to'), 'cat', coalesce(btrim(p ->> 'cat'), ''), 'unit', coalesce(btrim(p ->> 'unit'), ''));
      end if;
    elsif k = 'ignore' then
      if length(coalesce(p ->> 'shape', '')) between 3 and 160 and (p ->> 'shape') !~ '[0-8０-８]' then
        kk := lower(regexp_replace(p ->> 'shape', '\s', '', 'g'));
        pl := jsonb_build_object('shape', btrim(regexp_replace(p ->> 'shape', '\s+', ' ', 'g')));
      end if;
    elsif k = 'ccy' then
      if coalesce(p ->> 'ccy', '') ~ '^[A-Z]{3}$' then kk := lower(p ->> 'ccy'); pl := jsonb_build_object('ccy', p ->> 'ccy'); end if;
    elsif k = 'unit' then
      if length(coalesce(btrim(p ->> 'unit'), '')) between 1 and 20 then kk := lower(btrim(p ->> 'unit')); pl := jsonb_build_object('unit', btrim(p ->> 'unit')); end if;
    elsif k = 'qty_as_unit' then
      if jsonb_typeof(p -> 'on') = 'boolean' then kk := (p ->> 'on'); pl := jsonb_build_object('on', (p -> 'on')); end if;
    end if;
    if kk is null then continue; end if;
    insert into public.email_rule_proposals (sv, kind, key, payload, reason) values (v, k, kk, pl, r)
      on conflict (sv, kind, key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.email_rule_propose(text, jsonb) from public;
grant execute on function public.email_rule_propose(text, jsonb) to anon, authenticated;

-- 人が採用／却下する入口（チームメンバー。決めた人と日時は自動で記録）
create or replace function public.email_rule_decide(p_id bigint, p_status text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_team_member() then return false; end if;
  if p_status not in ('accepted', 'rejected') then return false; end if;
  update public.email_rule_proposals
     set status = p_status, decided_by = lower(coalesce(auth.jwt() ->> 'email', '')), decided_at = now()
   where id = p_id and status = 'pending';
  return found;
end $$;
revoke all on function public.email_rule_decide(bigint, text) from public, anon;
grant execute on function public.email_rule_decide(bigint, text) to authenticated;

-- ---- 読み取り口（置き換え）：サブコン名つきの評価・いまのルール・これまでの提案も返す ----
create or replace function public.email_import_export(p_token text, p_status text default 'new', p_limit int default 300)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare lim int := greatest(least(coalesce(p_limit, 300), 500), 1);
begin
  if not email_export_token_ok(p_token) then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'unread', coalesce((select jsonb_agg(to_jsonb(u) order by u.seen_count desc, u.last_seen desc)
                        from (select shape, seen_count, first_seen, last_seen, status, note from public.email_import_unread
                              where p_status = 'all' or status = p_status order by seen_count desc, last_seen desc limit lim) u), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(to_jsonb(f) order by f.seen_count desc, f.last_seen desc)
                          from (select kind, shape, hint, sv, seen_count, first_seen, last_seen, status, note from public.email_import_feedback
                                where p_status = 'all' or status = p_status order by seen_count desc, last_seen desc limit lim) f), '[]'::jsonb),
    -- いまのルール（登録者のメールアドレスなどは返さない）
    'rules', coalesce((select jsonb_agg(jsonb_build_object(
                         'sv', d.value,
                         'aliases', coalesce((select jsonb_agg(jsonb_build_object('from', a ->> 'from', 'to', a ->> 'to', 'cat', coalesce(a ->> 'cat', ''), 'unit', coalesce(a ->> 'unit', '')))
                                              from jsonb_array_elements(case when jsonb_typeof(d.details -> 'importRules' -> 'aliases') = 'array' then d.details -> 'importRules' -> 'aliases' else '[]'::jsonb end) a), '[]'::jsonb),
                         'ignore', coalesce((select jsonb_agg(x ->> 'shape')
                                             from jsonb_array_elements(case when jsonb_typeof(d.details -> 'importRules' -> 'ignore') = 'array' then d.details -> 'importRules' -> 'ignore' else '[]'::jsonb end) x), '[]'::jsonb),
                         'ccy', coalesce(d.details -> 'importRules' ->> 'ccy', ''),
                         'unit', coalesce(d.details -> 'importRules' ->> 'unit', ''),
                         'qtyAsUnit', coalesce((d.details -> 'importRules' ->> 'qtyAsUnit')::boolean, false)))
                       from public.master_details d
                       where d.field = 'sv' and d.details ? 'importRules'), '[]'::jsonb),
    -- これまでの提案（同じ提案を出し直さないため。却下されたものも含む）
    'proposals', coalesce((select jsonb_agg(jsonb_build_object('sv', sv, 'kind', kind, 'key', key, 'status', status) order by created_at desc)
                           from public.email_rule_proposals), '[]'::jsonb)
  );
end $$;
revoke all on function public.email_import_export(text, text, int) from public;
grant execute on function public.email_import_export(text, text, int) to anon, authenticated;
