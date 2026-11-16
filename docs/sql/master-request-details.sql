-- マスターの申請に「詳細」と「申請メモ」を持たせる（マスター管理の「マスターを申請」から、詳細ごと申請できるように）
-- Supabase の SQL Editor で 1 回実行してください（何度実行しても安全）。
-- 実行するまでは従来どおり：申請は名前（と港の国）だけで、詳細・メモは付けられません（申請の画面で案内が出ます）。
-- master-approval.sql（master_requests）の実行が前提です。

alter table public.master_requests add column if not exists details jsonb;   -- 申請者が入れた詳細（MD_SCHEMA のキー。承認時にマスター詳細として登録される）
alter table public.master_requests add column if not exists note    text;    -- 申請者から管理者へのメモ（任意）
comment on column public.master_requests.details is '申請者が入れたマスター詳細（承認時に master_details へ登録）';
comment on column public.master_requests.note    is '申請者から管理者へのメモ';
