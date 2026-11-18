#!/usr/bin/env node
/**
 * fetch-email-unread.js — メール取込の「読めなかった行」と「評価の記録」を Supabase から取得して表示する（AI / 開発者用）
 *
 * 返ってくるのは、数字を 9 に伏せた形だけ（金額・メールアドレス・URL・社名は含まない）。公開リポジトリに記録の中身を書き出さないため、
 * トークン付きの読み取り専用 RPC（docs/sql/email-import-feedback.sql の email_import_export）を呼ぶ。
 *
 * 使い方：
 *   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=sb_publishable_xxx EMAIL_EXPORT_TOKEN=xxxx \
 *   node scripts/fetch-email-unread.js [--status new|handled|ignored|all] [--json] [--limit 300]
 *   ・環境変数が無いときは使い方だけ表示して正常終了（CI を壊さない）
 */
'use strict';
function arg(name, dflt) { const i = process.argv.indexOf(name); if (i < 0) return dflt; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : true; }

async function main() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY || '';
  const token = process.env.EMAIL_EXPORT_TOKEN || '';
  if (!url || !key || !token) { console.log('SUPABASE_URL / SUPABASE_ANON_KEY / EMAIL_EXPORT_TOKEN を環境変数に設定してください（docs/sql/email-import-feedback.sql 参照）。'); return; }
  const status = typeof arg('--status', 'new') === 'string' ? arg('--status', 'new') : 'new';
  const limit = Number(arg('--limit', 300)) || 300;
  const res = await fetch(url + '/rest/v1/rpc/email_import_export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
    body: JSON.stringify({ p_token: token, p_status: status, p_limit: limit }),
  });
  if (!res.ok) { console.error('取得に失敗しました：HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300)); process.exitCode = 1; return; }
  const d = await res.json();
  if (arg('--json', false)) { console.log(JSON.stringify(d, null, 2)); return; }
  const un = d.unread || [], fb = d.feedback || [];
  if (!un.length && !fb.length) { console.log('記録はありません（トークンが違う可能性もあります）。'); return; }
  const day = s => String(s || '').slice(0, 10);
  const lines = ['# メール取込：解析の改善材料（数字は 9 に伏せてあります）', ''];
  lines.push('## ⚠ 読み取れなかった行（' + un.length + ' 件）');
  un.forEach(r => lines.push('- ×' + r.seen_count + '  `' + r.shape + '`  (' + day(r.last_seen) + (r.status !== 'new' ? '・' + r.status : '') + ')'));
  const group = (kind, title) => {
    const a = fb.filter(r => r.kind === kind);
    lines.push('', '## ' + title + '（' + a.length + ' 件）');
    a.forEach(r => lines.push('- ×' + r.seen_count + '  `' + r.shape + '`' + (r.hint ? '  → ' + r.hint : '') + '  (' + day(r.last_seen) + ')'));
  };
  group('fix', '✏️ 品名・カテゴリ・単位を直した行（解析が間違えた例）');
  group('ignore', '❌ 明細ではないとされた行（解析が明細にしてしまった例）');
  group('ok', '✅ 合っていた行（解析の正解例）');
  console.log(lines.join('\n'));
}
main().catch(e => { console.error(e && e.message ? e.message : e); process.exitCode = 1; });
