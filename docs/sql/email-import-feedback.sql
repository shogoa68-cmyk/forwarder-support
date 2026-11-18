-- ============================================================
-- 📩 メール取込：行の「評価」の蓄積と、AI が読むための読み取り口（解析パターンを増やすための材料）
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：is_team_member()・get_my_role() が作成済みであること。docs/sql/email-import-unread.sql も先に実行しておくこと（読み取り口が両方を返す）。
-- 未実行でもアプリは動く（記録されないだけ）。
--
-- 何を保存するか：サブコン専用の取込の確認画面で、人が行に付けた評価を「数字をすべて 9 に伏せた形」で記録する。
--   kind = 'ok'     ✅ 解析結果が合っていた行（解析の正解例＝試験の材料）
--   kind = 'ignore' ❌ 明細ではない行／「今後は無視」にした行（解析が明細にしてしまった・読めなかった行の例）
--   kind = 'fix'    ✏️ 品名・カテゴリ・単位を直した行（解析が間違えた例）
--   shape = 元の行（数字を 9 に伏せたもの）／hint = 'fix' のときの「解析の結果 → 直した結果」（これも数字は 9 だけ）
--   保存しないもの：金額・数量などの数字／メールアドレス・URL／サブコン名・お客様名・案件の情報／記録した人
--   ※ このリポジトリは公開のため、記録の中身はリポジトリには書き出さない。読むのは Supabase 経由だけ。
--
-- 書き込みは email_feedback_record() だけ（画面から表を直接書き換えられない）。サーバー側でも伏せ字を強制する。
-- 読み取り口 email_import_export(token) は、トークンを知っている人（AI の作業環境）だけが、記録を全部読める。
-- ============================================================

create table if not exists public.email_import_feedback (
  kind        text not null check (kind in ('ok', 'ignore', 'fix')),
  shape       text not null,                              -- 数字を 9 に伏せた行
  hint        text not null default '',                   -- fix：「解析 → 直し」（数字は 9 だけ）。それ以外は空
  seen_count  integer not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  status      text not null default 'new' check (status in ('new', 'handled', 'ignored')),
  note        text,
  primary key (kind, shape, hint)
);
create index if not exists email_import_feedback_status_idx on public.email_import_feedback (status, last_seen desc);

alter table public.email_import_feedback enable row level security;
revoke all on public.email_import_feedback from anon;
revoke insert, update, delete on public.email_import_feedback from authenticated;
grant select on public.email_import_feedback to authenticated;
grant update (status, note) on public.email_import_feedback to authenticated;

drop policy if exists "eif select" on public.email_import_feedback;
create policy "eif select" on public.email_import_feedback for select to authenticated using (is_team_member());
drop policy if exists "eif update" on public.email_import_feedback;
create policy "eif update" on public.email_import_feedback for update to authenticated
  using (get_my_role() = 'admin') with check (get_my_role() = 'admin');

-- 記録の入口：items = [{"kind":"ok|ignore|fix","shape":"…","hint":"…"}]。チームメンバーだけ・1 回に最大 20 件
create or replace function public.email_feedback_record(items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb; k text; s text; h text; n integer := 0;
begin
  if not is_team_member() then return 0; end if;
  if jsonb_typeof(coalesce(items, 'null'::jsonb)) <> 'array' then return 0; end if;
  for it in select * from jsonb_array_elements(items) loop
    exit when n >= 20;
    if jsonb_typeof(it) <> 'object' then continue; end if;
    k := it ->> 'kind';
    s := btrim(regexp_replace(coalesce(it ->> 'shape', ''), '\s+', ' ', 'g'));
    h := btrim(regexp_replace(coalesce(it ->> 'hint', ''), '\s+', ' ', 'g'));
    if k in ('ok', 'ignore', 'fix')
       and length(s) between 3 and 160
       and length(h) <= 160
       and (s || h) !~ '[0-8０-８]'
       and (s || h) !~ '@'
       and (s || h) !~* 'https?://' then
      insert into public.email_import_feedback (kind, shape, hint) values (k, s, h)
      on conflict (kind, shape, hint) do update
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

-- ============================================================
-- 【AI 用の読み取り口】トークンを知っている人だけが、読めなかった行と評価の記録を読める（返すのは伏せた形だけ）
-- 実行前に下の '<長いランダム文字列>' を必ず置き換えること（32 文字以上）。再実行すると差し替わる＝漏れたら差し替えれば即無効。
-- Claude のセッション側には、同じ値を環境変数 EMAIL_EXPORT_TOKEN（と SUPABASE_URL・SUPABASE_ANON_KEY）として登録する（コミットしない）。
-- ============================================================
create table if not exists public.email_export_keys (
  id    int primary key default 1,
  token text not null,
  constraint email_export_single_row check (id = 1)
);
alter table public.email_export_keys enable row level security;   -- ポリシー無し＝誰も直接読めない
revoke all on public.email_export_keys from anon, authenticated;
insert into public.email_export_keys (id, token) values (1, '<長いランダム文字列>')
  on conflict (id) do update set token = excluded.token;

create or replace function public.email_import_export(p_token text, p_status text default 'new', p_limit int default 300)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare ok boolean;
begin
  select (token = p_token and length(token) >= 32) into ok from public.email_export_keys where id = 1;
  if not coalesce(ok, false) then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'unread', coalesce((select jsonb_agg(to_jsonb(u) order by u.seen_count desc, u.last_seen desc)
                        from (select shape, seen_count, first_seen, last_seen, status, note from public.email_import_unread
                              where p_status = 'all' or status = p_status order by seen_count desc, last_seen desc limit greatest(least(p_limit, 500), 1)) u), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(to_jsonb(f) order by f.seen_count desc, f.last_seen desc)
                          from (select kind, shape, hint, seen_count, first_seen, last_seen, status, note from public.email_import_feedback
                                where p_status = 'all' or status = p_status order by seen_count desc, last_seen desc limit greatest(least(p_limit, 500), 1)) f), '[]'::jsonb)
  );
end $$;
revoke all on function public.email_import_export(text, text, int) from public;
grant execute on function public.email_import_export(text, text, int) to anon, authenticated;
