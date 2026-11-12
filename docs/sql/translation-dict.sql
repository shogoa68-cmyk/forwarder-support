-- 英訳辞書（御見積書の英語出力で、日本語の品名・リマークを英語にするための対応表／チーム共有）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても同じ結果になる）
-- 前提: is_team_member()（チームメンバー判定）が作成済みであること
--
-- ja＝日本語の語句・文（空白・全角半角をそろえた形）、en＝英語。内蔵の辞書より、ここの登録が優先される。
-- 外部の翻訳サービスは使わない（ここに登録した対応だけが英語になる）。

create table if not exists public.translation_dict (
  id          uuid        primary key default gen_random_uuid(),
  ja          text        not null unique,
  en          text        not null,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.translation_dict enable row level security;
grant select, insert, update, delete on public.translation_dict to authenticated;

drop policy if exists "team members can read translation_dict" on public.translation_dict;
create policy "team members can read translation_dict" on public.translation_dict
  for select using (is_team_member());

drop policy if exists "team members can insert translation_dict" on public.translation_dict;
create policy "team members can insert translation_dict" on public.translation_dict
  for insert with check (is_team_member() and created_by = (auth.jwt() ->> 'email'));

drop policy if exists "team members can update translation_dict" on public.translation_dict;
create policy "team members can update translation_dict" on public.translation_dict
  for update using (is_team_member()) with check (is_team_member());

drop policy if exists "team members can delete translation_dict" on public.translation_dict;
create policy "team members can delete translation_dict" on public.translation_dict
  for delete using (is_team_member());
