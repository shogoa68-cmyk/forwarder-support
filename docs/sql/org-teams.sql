-- ============================================================
-- 🏢 組織とチーム（名簿の整理・ダッシュボードの「全体／組織／チーム／自分」の絞り込み用）
-- Supabase の SQL Editor で実行（何度実行しても安全＝冪等）
-- 前提：is_team_member()（チームメンバー判定）・get_my_role()（allowed_emails.role）・allowed_emails が作成済みであること
--
-- 位置づけ：データの「見える範囲」は変えない（これまでどおり、メンバー全員が全案件を見られる）。
--   組織・チームは、メンバーの所属を整理し、案件を「誰の所属の案件か」で絞り込むためのもの。
--   ・組織：1 人が属するのは 1 つ（会社・部門など）
--   ・チーム：組織の中に作る。1 人が複数のチームに属してよい（同じ組織のチームだけ）
-- 未実行でもアプリは動く（「組織」「チーム」の絞り込みが出ないだけ）。
-- ============================================================

-- ① 組織
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists organizations_name_uq on public.organizations (lower(name));

-- ② チーム（組織の中）
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists teams_org_name_uq on public.teams (org_id, lower(name));

-- ③ メンバーの所属組織（1 人 1 組織・email は小文字で持つ）
create table if not exists public.org_members (
  email      text primary key,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ④ メンバーの所属チーム（複数可）
create table if not exists public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (team_id, email)
);

-- ⑤ 権限：読む＝チームメンバー全員／変える＝管理者だけ（画面の出し分けとは別に、サーバー側でも強制）
alter table public.organizations enable row level security;
alter table public.teams         enable row level security;
alter table public.org_members   enable row level security;
alter table public.team_members  enable row level security;
grant select, insert, update, delete on public.organizations, public.teams, public.org_members, public.team_members to authenticated;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'teams', 'org_members', 'team_members'] loop
    execute format('drop policy if exists "ot select" on public.%I', t);
    execute format('create policy "ot select" on public.%I for select to authenticated using (is_team_member())', t);
    execute format('drop policy if exists "ot admin write" on public.%I', t);
    execute format($p$create policy "ot admin write" on public.%I for all to authenticated
                      using (coalesce(get_my_role(), 'member') = 'admin')
                      with check (coalesce(get_my_role(), 'member') = 'admin')$p$, t);
  end loop;
end $$;

-- ⑥ 初期の組織を作り、いまのメンバー全員をそこへ入れる（組織がまだ 1 つも無いときだけ作る）
insert into public.organizations (name)
  select '初期の組織' where not exists (select 1 from public.organizations);

insert into public.org_members (email, org_id)
  select lower(a.email), (select id from public.organizations order by created_at, id limit 1)
  from public.allowed_emails a
  on conflict (email) do nothing;

-- ⑦ これから招待するメンバーは、いちばん古い組織（＝初期の組織）に自動で入る。メンバーを削除したら所属も消す
create or replace function public.org_on_member_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.org_members (email, org_id)
    select lower(new.email), id from public.organizations order by created_at, id limit 1
    on conflict (email) do nothing;
  return new;
end; $$;
drop trigger if exists org_on_member_insert_trg on public.allowed_emails;
create trigger org_on_member_insert_trg after insert on public.allowed_emails
  for each row execute function public.org_on_member_insert();

create or replace function public.org_on_member_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.team_members where email = lower(old.email);
  delete from public.org_members  where email = lower(old.email);
  return old;
end; $$;
drop trigger if exists org_on_member_delete_trg on public.allowed_emails;
create trigger org_on_member_delete_trg after delete on public.allowed_emails
  for each row execute function public.org_on_member_delete();
