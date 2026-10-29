-- キャリア → サブコン 統合（段階 2）の前に、影響範囲を数える（読み取りだけ。何も変更しない）
-- 実行方法: Supabase ダッシュボード → SQL Editor に貼り付けて Run（何度実行しても安全）
-- アプリの画面（マスター管理 → キャリア → 「影響範囲を確認する」）でも、同じ内容を詳しく見られます。

-- 1) キャリアとサブコンのマスター件数
select field, count(distinct value) as masters
from public.master_votes
where field in ('carrier', 'sv')
group by field order by field;

-- 2) 別名のグループ（キャリア／サブコン）
select field, count(*) as groups, sum(jsonb_array_length(aliases)) as aliases
from public.synonym_groups
where field in ('carrier', 'sv')
group by field order by field;

-- 3) 詳細（ふりがな・英語名・グループ・種別 など）の件数
select field, count(*) as details
from public.master_details
where field in ('carrier', 'sv')
group by field order by field;

-- 4) 同じ名前（大文字小文字・空白を無視）がキャリアとサブコンの両方にあるマスター ＝ 合流が要るもの
select c.value as carrier, s.value as sv
from (select distinct value from public.master_votes where field = 'carrier') c
join (select distinct value from public.master_votes where field = 'sv') s
  on lower(regexp_replace(c.value, '\s', '', 'g')) = lower(regexp_replace(s.value, '\s', '', 'g'))
order by 1;

-- 5) キャリアの統合ルール（過去データの一括置換）の件数
select count(*) as carrier_alias_rules from public.alias_rules where field = 'carrier';

-- 6) 承認待ちの申請（キャリア）
select count(*) as pending_carrier_requests
from public.master_requests
where field = 'carrier' and status = 'pending';
