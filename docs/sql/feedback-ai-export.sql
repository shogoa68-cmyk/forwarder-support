-- ============================================================
-- 【任意】AI（Claude）が不具合報告を直接読めるようにする読み取り専用 API
-- 公開リポジトリには報告内容を書き出さない方針のため、トークン付きの RPC で提供する。
-- Supabase の SQL Editor で実行。実行前に下の '<長いランダム文字列>' を必ず置き換えること
-- （32文字以上。例：ブラウザの crypto.randomUUID() を2つつなげる）。
-- ・返すのは feedbacks のみ・メールアドレスは含めない・最新200件まで。
-- ・トークンはこの SQL に書いた値だけが有効。漏れたら下の update で差し替えれば即無効。
-- ・Claude のセッション側には、同じ値を環境変数 FEEDBACK_EXPORT_TOKEN（と SUPABASE_URL、
--   SUPABASE_ANON_KEY=publishable key）として登録する（コミットしない）。
-- ============================================================

create table if not exists public.feedback_export_keys (
  id    int primary key default 1,
  token text not null,
  constraint single_row check (id = 1)
);
alter table public.feedback_export_keys enable row level security;   -- ポリシー無し＝誰も直接読めない
revoke all on public.feedback_export_keys from anon, authenticated;

-- ★ここを置き換えてから実行（再実行すると差し替わる）
insert into public.feedback_export_keys (id, token) values (1, '<長いランダム文字列>')
  on conflict (id) do update set token = excluded.token;

create or replace function public.feedback_export(p_token text, p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare ok boolean;
begin
  select (token = p_token) into ok from public.feedback_export_keys where id = 1;
  if not coalesce(ok, false) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.created_at desc)
    from (
      select report_no, id, created_at, updated_at, category, section, title, body, status,
             response, responded_at, page_url, context,
             jsonb_array_length(coalesce(attachments, '[]'::jsonb)) as attachment_count
      from public.feedbacks
      order by created_at desc
      limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) t
  ), '[]'::jsonb);
end; $$;

revoke all on function public.feedback_export(text, int) from public;
grant execute on function public.feedback_export(text, int) to anon, authenticated;
