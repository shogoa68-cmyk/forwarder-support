#!/usr/bin/env bash
# メール取込「読み取れなかった行」の蓄積（docs/sql/email-import-feedback.sql／email-import-unread.sql）を、使い捨ての PostgreSQL に
# 「Supabase の仕組みの簡易な再現」を作って実際に流して確かめる。
#   使い方：PGHOST/PGPORT/PGUSER を設定した psql が使える状態で  bash scripts/sql-tests/email-unread-sql-test.sh
#   ※ 本物の Supabase ではない。RLS・権限・伏せ字の強制・冪等の論理を確かめるもの。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
DB="feedback_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
export PGDATABASE="$DB"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
ng()  { FAIL=$((FAIL+1)); echo "✗ NG: $1"; }
check() { if [ "$2" = "$3" ]; then ok; else ng "$1（期待=$2 実際=$3）"; fi; }

$PSQL <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb $f$;
create table public.allowed_emails (email text primary key, role text);
create function public.is_team_member() returns boolean language sql security definer stable as
  $f$ select exists (select 1 from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email',''))) $f$;
create function public.get_my_role() returns text language sql security definer stable as
  $f$ select role from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email','')) $f$;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant execute on function public.is_team_member(), public.get_my_role() to anon, authenticated;
insert into public.allowed_emails values ('admin@example.com','admin'), ('member@example.com','member');
alter default privileges in schema public grant all on tables to anon, authenticated;
create table public.master_details (field text, value text, details jsonb, primary key (field, value));
SQL

TOKEN='0123456789abcdef0123456789abcdef-test'
for i in 1 2; do
  $PSQL -f "$ROOT/docs/sql/email-import-unread.sql" >/dev/null
  sed "s/<長いランダム文字列>/$TOKEN/" "$ROOT/docs/sql/email-import-feedback.sql" | $PSQL >/dev/null
done
ok; echo "PASS SQL を 2 回流してもエラーなし（冪等）"

as() { $PSQL -At -c "set role $1; select set_config('request.jwt.claims', '{\"email\":\"$2\"}', false); $3" 2>&1 | tail -1; }
err() { sed -E 's/^ERROR:  (permission denied|new row violates row-level security policy).*/\1/'; }
rec() { as authenticated "$1" "select public.email_feedback_record('$2'::jsonb)"; }

check "メンバーは評価を記録できる（3 種で 3 件）" "3" "$(rec member@example.com '[{"kind":"ok","shape":"海上運賃 USD 9,999 /9GP"},{"kind":"ignore","shape":"注意書き USD 99 at cost"},{"kind":"fix","shape":"ドキュメント代 USD 99 /BL","hint":"解析=ドキュメント代 / 直し=DOC FEE / export-local / BL"}]')"
check "同じ内容をもう一度記録すると、行は増えず回数だけ増える" "2" "$(rec member@example.com '[{"kind":"ok","shape":"海上運賃 USD 9,999 /9GP"}]' >/dev/null; as authenticated member@example.com "select seen_count from public.email_import_feedback where kind='ok'")"
check "行は 3 件のまま" "3" "$(as authenticated member@example.com "select count(*) from public.email_import_feedback")"
check "伏せていない（数字 0〜8 を含む）shape は受け付けない" "0" "$(rec member@example.com '[{"kind":"ok","shape":"海上運賃 USD 1,200"}]')"
check "hint に伏せていない数字があれば受け付けない" "0" "$(rec member@example.com '[{"kind":"fix","shape":"品名 USD 99","hint":"直し=DOC 20FT"}]')"
check "全角の 0〜8 も受け付けない" "0" "$(rec member@example.com '[{"kind":"ok","shape":"保管料：￥８５０"}]')"
check "メールアドレスを含むものは受け付けない" "0" "$(rec member@example.com '[{"kind":"ignore","shape":"連絡先 taro@example.com 999"}]')"
check "URL を含むものは受け付けない" "0" "$(rec member@example.com '[{"kind":"ignore","shape":"見積 https://example.com/x 999"}]')"
check "kind が不正なら受け付けない" "0" "$(rec member@example.com '[{"kind":"evil","shape":"保管料 999"}]')"
check "配列でない入力は 0 件" "0" "$(rec member@example.com '{"kind":"ok","shape":"保管料 999"}')"
check "短すぎる shape は受け付けない" "0" "$(rec member@example.com '[{"kind":"ok","shape":"99"}]')"
check "チームメンバーでない人は記録できない" "0" "$(rec mallory@example.com '[{"kind":"ok","shape":"保管料 999"}]')"
check "未ログイン(anon)は呼べない" "permission denied" "$(as anon member@example.com "select public.email_feedback_record('[]'::jsonb)" | err)"
check "表を直接書き込めない（insert）" "permission denied" "$(as authenticated member@example.com "insert into public.email_import_feedback (kind, shape) values ('ok','x 999')" | err)"
check "表を直接削除できない" "permission denied" "$(as authenticated admin@example.com "delete from public.email_import_feedback" | err)"
check "メンバーは記録を読める" "OK" "$([ "$(as authenticated member@example.com "select count(*) from public.email_import_feedback")" -gt 0 ] && echo OK)"
check "メンバーでない人は 0 件" "0" "$(as authenticated mallory@example.com "select count(*) from public.email_import_feedback")"
check "管理者は対応状況を更新できる" "handled" "$(as authenticated admin@example.com "update public.email_import_feedback set status='handled', note='直した' where kind='ignore' returning status")"
check "メンバーは対応状況を更新できない（0 行）" "0" "$(as authenticated member@example.com "with u as (update public.email_import_feedback set status='ignored' returning 1) select count(*) from u")"
check "shape は管理者でも書き換えられない" "permission denied" "$(as authenticated admin@example.com "update public.email_import_feedback set shape='別 999'" | err)"
rec member@example.com '[{"kind":"ignore","shape":"注意書き USD 99 at cost"}]' >/dev/null
check "対応済みの形がまた出たら「新規」に戻る" "new" "$(as authenticated member@example.com "select status from public.email_import_feedback where kind='ignore'")"

# ----- 読み取り口（トークン） -----
exp() { as anon x@example.com "select jsonb_array_length(public.email_import_export('$1', '${2:-new}')->'feedback')"; }
check "正しいトークンなら記録が読める（3 件）" "3" "$(exp "$TOKEN")"
check "違うトークンでは何も返らない" "" "$(as anon x@example.com "select public.email_import_export('wrong-token', 'new')->'feedback'")"
check "既定のプレースホルダのままでは読めない（32 文字未満）" "" "$(as anon x@example.com "select public.email_import_export('<長いランダム文字列>', 'new')->'feedback'")"
check "トークンの表は直接読めない" "permission denied" "$(as authenticated admin@example.com "select * from public.email_export_keys" | err)"
check "未読み取りの行（email_import_unread）も一緒に返る" "1" "$(as authenticated member@example.com "select public.email_unread_record(array['読めない行 999'])" >/dev/null; as anon x@example.com "select jsonb_array_length(public.email_import_export('$TOKEN','new')->'unread')")"
check "返るのは伏せた形だけ（shape・hint に数字 0〜8 と @ を含まない）" "t" "$(as anon x@example.com "select coalesce(bool_and((shape || hint) !~ '[0-8@]'), false) from jsonb_to_recordset(public.email_import_export('$TOKEN','all')->'feedback') as x(shape text, hint text)")"


# ----- 🤖 AI の提案（docs/sql/email-rule-proposals.sql） -----
for i in 1 2; do $PSQL -f "$ROOT/docs/sql/email-rule-proposals.sql" >/dev/null; done
ok; echo "PASS 提案の SQL を 2 回流してもエラーなし（冪等）"
check "前からある記録は残る（主キーにサブコン名を足しても消えない）" "3" "$(as authenticated member@example.com "select count(*) from public.email_import_feedback")"
check "サブコン名つきで記録できる" "1" "$(rec member@example.com '[{"kind":"fix","shape":"THCD USD 99","hint":"解析=THCD / 直し=THC","sv":"ABC物流"}]')"
check "同じ形でもサブコンが違えば別の記録" "2" "$(rec member@example.com '[{"kind":"fix","shape":"THCD USD 99","hint":"解析=THCD / 直し=THC","sv":"XYZ運送"}]' >/dev/null; as authenticated member@example.com "select count(*) from public.email_import_feedback where shape='THCD USD 99'")"
check "サブコン名に @ を含むものは受け付けない" "0" "$(rec member@example.com '[{"kind":"ok","shape":"保管料 999","sv":"a@b"}]')"
prop() { as anon x@example.com "select public.email_rule_propose('$1', '$2'::jsonb)"; }
check "正しい合言葉で提案を書き込める（4 件）" "4" "$(prop "$TOKEN" '[{"sv":"ABC物流","kind":"alias","payload":{"from":"THCD","to":"THC","cat":"export-local","unit":"CNTR"},"reason":"直した例 3 件"},{"sv":"ABC物流","kind":"ignore","payload":{"shape":"Remarks: subject to space 999"}},{"sv":"ABC物流","kind":"ccy","payload":{"ccy":"USD"}},{"sv":"XYZ運送","kind":"qty_as_unit","payload":{"on":true}}]')"
check "違う合言葉では書き込めない" "0" "$(prop wrong-token '[{"sv":"ABC物流","kind":"ccy","payload":{"ccy":"JPY"}}]')"
check "同じ提案は重ねない" "0" "$(prop "$TOKEN" '[{"sv":"ABC物流","kind":"alias","payload":{"from":"thcd","to":"THC"}}]')"
check "伏せていない数字の行・不正な通貨・不明な種類・サブコン名なしは受け付けない" "0" "$(prop "$TOKEN" '[{"sv":"ABC物流","kind":"ignore","payload":{"shape":"Total 1,200"}},{"sv":"ABC物流","kind":"ccy","payload":{"ccy":"usd1"}},{"sv":"ABC物流","kind":"evil","payload":{}},{"sv":"","kind":"ccy","payload":{"ccy":"EUR"}}]')"
check "メンバーは提案を読める" "4" "$(as authenticated member@example.com "select count(*) from public.email_rule_proposals")"
check "メンバーでない人は 0 件" "0" "$(as authenticated mallory@example.com "select count(*) from public.email_rule_proposals")"
check "提案の表は直接書き込めない" "permission denied" "$(as authenticated admin@example.com "update public.email_rule_proposals set status='accepted'" | err)"
PID="$(as authenticated member@example.com "select id from public.email_rule_proposals where kind='alias'")"
check "メンバーは採用できる" "t" "$(as authenticated member@example.com "select public.email_rule_decide($PID, 'accepted')")"
check "決めた人と日時が残る" "member@example.com" "$(as authenticated member@example.com "select decided_by from public.email_rule_proposals where id=$PID and decided_at is not null")"
check "決まった提案はもう変えられない" "f" "$(as authenticated member@example.com "select public.email_rule_decide($PID, 'rejected')")"
check "メンバーでない人は決められない" "f" "$(as authenticated mallory@example.com "select public.email_rule_decide((select id from public.email_rule_proposals where kind='ccy'), 'rejected')")"
check "未ログイン(anon)は決められない" "permission denied" "$(as anon x@example.com "select public.email_rule_decide(1, 'accepted')" | err)"
as authenticated member@example.com "select public.email_rule_decide((select id from public.email_rule_proposals where kind='ccy'), 'rejected')" >/dev/null
check "却下した提案は出し直されない" "0" "$(prop "$TOKEN" '[{"sv":"ABC物流","kind":"ccy","payload":{"ccy":"USD"}}]')"
$PSQL -c "insert into public.master_details values ('sv','ABC物流','{\"importRules\":{\"aliases\":[{\"from\":\"DOCF\",\"to\":\"DOC FEE\",\"by\":\"member@example.com\"}],\"ccy\":\"USD\",\"by\":\"member@example.com\"}}'::jsonb)" >/dev/null
check "読み取り口は、評価にサブコン名を付けて返す" "t" "$(as anon x@example.com "select bool_or(sv = 'ABC物流') from jsonb_to_recordset(public.email_import_export('$TOKEN','all')->'feedback') as x(sv text)")"
check "読み取り口は、いまのルールを返す（登録者のメールは返さない）" "DOC FEE|false" "$(as anon x@example.com "select (public.email_import_export('$TOKEN','all')->'rules'->0->'aliases'->0->>'to') || '|' || ((public.email_import_export('$TOKEN','all')->'rules')::text like '%@%')::text")"
check "読み取り口は、これまでの提案（却下も）を返す" "4" "$(as anon x@example.com "select jsonb_array_length(public.email_import_export('$TOKEN','all')->'proposals')")"
sed "s/<長いランダム文字列>/<長いランダム文字列>/" "$ROOT/docs/sql/email-import-feedback.sql" | $PSQL >/dev/null
$PSQL -f "$ROOT/docs/sql/email-rule-proposals.sql" >/dev/null
check "置き換え忘れのまま流し直しても、使っている合言葉は消えない" "4" "$(as anon x@example.com "select jsonb_array_length(public.email_import_export('$TOKEN','all')->'proposals')")"

echo "$PASS 項目 OK / $FAIL 件 NG"; [ "$FAIL" = 0 ]
