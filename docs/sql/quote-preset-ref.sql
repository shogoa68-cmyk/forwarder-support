-- =====================================================================
-- quote_presets：見積もり番号（管理番号／仮REF#）を検索可能な独立列に昇格
-- =====================================================================
-- 目的：
--   ・見積もり番号（data.fields['qf-ref']）は今まで jsonb 内にしかなく、
--     「番号が分かっている案件をサーバー側で確実に検索・呼び出す」ことが
--     できなかった。
--   ・customer/person/pol/pod/carrier と同じ方式で ref 列へ昇格させ、
--     類似見積パネルの番号検索から直接 ilike/eq で引けるようにする。
--
-- 実行方法：
--   Supabase ダッシュボード → SQL Editor に貼り付けて Run。
--   （何度流しても安全なように IF NOT EXISTS で冪等化）
--
-- 前提：
--   ・既存テーブル public.quote_presets が存在すること
--   ・以降の保存（cloud.js）は qf-ref を自動的に ref 列へも反映する
-- =====================================================================

-- 1) ref 列 -------------------------------------------------------------
alter table public.quote_presets
  add column if not exists ref text;

comment on column public.quote_presets.ref is
  '見積もり番号（管理番号／仮REF#）。data.fields[''qf-ref''] のミラー。保存時にアプリ側で同期する';

-- 2) 既存案件の遡及反映 ---------------------------------------------------
update public.quote_presets
set ref = nullif(trim(both from (data -> 'fields' ->> 'qf-ref')), '')
where ref is null;

-- 3) 検索用インデックス ---------------------------------------------------
create index if not exists idx_quote_presets_ref on public.quote_presets (ref);
