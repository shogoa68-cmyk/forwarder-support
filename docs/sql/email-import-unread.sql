-- ============================================================
-- 📩 メール取込：「読み取れなかった行」の蓄積（解析パターンを増やすための材料）
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：is_team_member()（チームメンバー判定）と get_my_role()（allowed_emails.role を返す）が作成済みであること
-- 未実行でもアプリは動く（記録されないだけ）。
--
-- 何を保存するか：メール取込で金額らしい数字を含むのに明細にできなかった行を、
--   「数字をすべて 9 に伏せた形」で 1 件ずつ（同じ形は 1 件にまとめて回数を数える）。
--   例）定温庫保管料：\850/M3/期  →  定温庫保管料：\999/M3/期
--   保存しないもの：金額・数量などの数字／サブコン名・お客様名／メールアドレス・URL／案件の情報／記録した人
--   ※ 解析が読めない原因は「書き方（\ や /期 など）」で、金額そのものではないため、伏せても直すための情報は残る。
--   ※ このリポジトリは公開のため、記録の中身はリポジトリには書き出さない。読むのは Supabase 経由だけ。
--
-- 書き込みは email_unread_record() だけ（画面から表を直接書き換えられない）。
--   サーバー側でも「数字は 9 だけ」「メールアドレスを含まない」を強制する（画面側の不具合で本物の数字が入らないように）。
-- ============================================================

create table if not exists public.email_import_unread (
  shape       text primary key,                          -- 数字を 9 に伏せた行（重複は 1 件）
  seen_count  integer not null default 1,                -- 何回見たか
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  status      text not null default 'new' check (status in ('new', 'handled', 'ignored')),   -- 新規／対応済み／無視
  note        text                                       -- 対応メモ（どう直したか）
);
create index if not exists email_import_unread_status_idx on public.email_import_unread (status, last_seen desc);

alter table public.email_import_unread enable row level security;
revoke all on public.email_import_unread from anon;
-- Supabase は新しい表に標準で全権限を付けるため、いったん外してから必要な分だけ渡す（列を絞った更新権限だけでは足りない）
revoke insert, update, delete on public.email_import_unread from authenticated;
grant select on public.email_import_unread to authenticated;
grant update (status, note) on public.email_import_unread to authenticated;

-- 閲覧：チームメンバー全員
drop policy if exists "unread select" on public.email_import_unread;
create policy "unread select" on public.email_import_unread for select to authenticated
  using (is_team_member());

-- 対応状況（status・note）の更新：管理者だけ
drop policy if exists "unread update" on public.email_import_unread;
create policy "unread update" on public.email_import_unread for update to authenticated
  using (get_my_role() = 'admin') with check (get_my_role() = 'admin');

-- 記録の入口：チームメンバーだけ・1 回に最大 20 件・伏せていない行は受け付けない
create or replace function public.email_unread_record(shapes text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s text;
  n integer := 0;
begin
  if not is_team_member() then return 0; end if;
  foreach s in array coalesce(shapes, '{}'::text[]) loop
    exit when n >= 20;
    s := btrim(regexp_replace(coalesce(s, ''), '\s+', ' ', 'g'));
    -- 3〜160 文字／数字は 9 だけ（半角・全角とも）／メールアドレス・URL を含まない
    if length(s) between 3 and 160
       and s !~ '[0-8０-８]'
       and s !~ '@'
       and s !~* 'https?://' then
      insert into public.email_import_unread (shape) values (s)
      on conflict (shape) do update
        set seen_count = public.email_import_unread.seen_count + 1,
            last_seen  = now(),
            status     = case when public.email_import_unread.status = 'handled' then 'new' else public.email_import_unread.status end;   -- 対応済みの形がまた出たら「新規」に戻す
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.email_unread_record(text[]) from public, anon;
grant execute on function public.email_unread_record(text[]) to authenticated;
