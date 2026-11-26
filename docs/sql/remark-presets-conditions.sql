-- =====================================================================
-- remark_presets：おすすめ表示の「条件」・英文 ／ 使った記録（remark_preset_uses）
-- =====================================================================
-- 目的：
--   ① 段階 1：共有プリセットに「どんな見積のときに使うか」の条件（conditions）と
--      英語出力用の英文（en）を持たせる。条件に合う見積では、定型文のタブの先頭
--      「🎯 おすすめ」に出す。
--   ② 段階 2：プリセットを押したときの見積の条件（輸送モード・国・品物の区分など）を
--      記録し（remark_preset_uses）、似た条件の見積でよく使われる文をおすすめに出す。
--   ③ 段階 3（過去のリマークから候補を探す）は読み取りだけなので SQL は不要。
--
-- 実行方法：Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度流しても安全）。
--
-- 前提：
--   ・public.remark_presets（docs/supabase-remark-presets-setup.sql）があること
--   ・チーム判定関数 public.is_team_member() があること
--
-- 未実行でも画面は動く：
--   ・条件・英文は「この端末の個人プリセット」にだけ保存でき、共有プリセットに付けようと
--     すると「SQL が未実行」と案内が出る（ラベル・本文は従来どおり保存される）
--   ・使った記録は送らない（おすすめは、条件を付けたプリセットだけで出る）
-- =====================================================================

-- ① 条件と英文（NULL＝条件なし＝おすすめには出さない汎用プリセット）
alter table public.remark_presets
  add column if not exists conditions jsonb,
  add column if not exists en text;

comment on column public.remark_presets.conditions is
  'おすすめに出す条件。{"mode":["fcl"],"dir":["export"],"cc":["IN"],"port":["NHAVA SHEVA"],"cargo":["自動車"],"kw":["電池"],"inco":["FOB"],"haz":["dg"]}。指定した項目はすべて満たす（項目の中はどれか）。NULL＝条件なし';
comment on column public.remark_presets.en is
  '英語出力（御見積書の「英語で出力」）で使う英文。空なら英訳辞書で訳す';

-- 条件は「オブジェクト」だけ受け付ける（配列や文字列を入れて画面を壊さない）
alter table public.remark_presets drop constraint if exists remark_presets_conditions_obj;
alter table public.remark_presets add constraint remark_presets_conditions_obj
  check (conditions is null or jsonb_typeof(conditions) = 'object');

-- ② 使った記録
create table if not exists public.remark_preset_uses (
  id          bigserial primary key,
  preset_key  text        not null,                 -- 's:<共有プリセットの id>'／'b:<標準の定型文の名前>'／'c:<品物別の標準の名前>'
  used_by     text,                                 -- 押した人（トリガーがログイン中のメールを入れる）
  used_at     timestamptz not null default now(),
  ctx         jsonb       not null default '{}'::jsonb   -- そのときの見積の条件（金額・お客様名・本文は入れない）
);

comment on table public.remark_preset_uses is
  'リマークのプリセットを押したときの見積の条件（輸送モード・国・品物の区分・貿易条件・危険品など）。似た条件の見積でのおすすめの順番に使う';

create index if not exists idx_remark_uses_at  on public.remark_preset_uses (used_at desc);
create index if not exists idx_remark_uses_key on public.remark_preset_uses (preset_key);

alter table public.remark_preset_uses drop constraint if exists remark_uses_ctx_obj;
alter table public.remark_preset_uses add constraint remark_uses_ctx_obj
  check (jsonb_typeof(ctx) = 'object' and length(ctx::text) <= 2000);
alter table public.remark_preset_uses drop constraint if exists remark_uses_key_len;
alter table public.remark_preset_uses add constraint remark_uses_key_len
  check (length(preset_key) between 3 and 200);

-- 押した人・日時はサーバーで決める（画面から他人の名前・過去の日時を書けない）
create or replace function public.remark_uses_stamp()
returns trigger language plpgsql as $$
begin
  new.used_by := lower(coalesce(auth.jwt() ->> 'email', ''));
  new.used_at := now();
  return new;
end $$;

drop trigger if exists trg_remark_uses_stamp on public.remark_preset_uses;
create trigger trg_remark_uses_stamp before insert on public.remark_preset_uses
  for each row execute function public.remark_uses_stamp();

-- 権限：読む・足すだけ（書き換え・削除は画面からはできない）
revoke all on public.remark_preset_uses from anon, authenticated;
grant select, insert on public.remark_preset_uses to authenticated;
grant usage, select on sequence public.remark_preset_uses_id_seq to authenticated;

alter table public.remark_preset_uses enable row level security;

drop policy if exists "team read remark uses" on public.remark_preset_uses;
create policy "team read remark uses" on public.remark_preset_uses
  for select using (public.is_team_member());

drop policy if exists "team insert remark uses" on public.remark_preset_uses;
create policy "team insert remark uses" on public.remark_preset_uses
  for insert with check (public.is_team_member());

-- 共有プリセットを消したら、その記録も消す（標準の定型文の記録は残す）
create or replace function public.remark_presets_drop_uses()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.remark_preset_uses where preset_key = 's:' || old.id::text;
  return old;
end $$;

drop trigger if exists trg_remark_presets_drop_uses on public.remark_presets;
create trigger trg_remark_presets_drop_uses after delete on public.remark_presets
  for each row execute function public.remark_presets_drop_uses();

-- 古い記録の掃除（2 年より前）。pg_cron があれば月 1 回などで呼ぶ（任意）
create or replace function public.remark_preset_uses_purge()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.remark_preset_uses where used_at < now() - interval '2 years';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.remark_preset_uses_purge() from public, anon, authenticated;
