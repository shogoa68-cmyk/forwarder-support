-- 港の登録申請に「国」を持たせる（見積の POL／経由地／POD で国を選んで未登録の港を申請したとき、承認と一緒に国を付ける）
-- Supabase の SQL Editor で 1 回実行してください（何度実行しても安全）。
-- 実行するまでは従来どおり：申請は名前だけで、国は承認後にマスター管理（港の詳細の「国」）で設定します。
-- master-approval.sql（master_requests）の実行が前提です。

alter table public.master_requests add column if not exists country text;   -- 国コード（ISO 3166-1 alpha-2。例：VN）。港の申請のときだけ入る
comment on column public.master_requests.country is '港の申請に付ける国コード（承認時にマスター詳細の country として登録される）';
