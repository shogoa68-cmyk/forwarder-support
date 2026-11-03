#!/usr/bin/env node
/**
 * fetch-feedback.js — 不具合報告を Supabase から取得して Markdown で表示する（AI / 開発者用）
 *
 * 公開リポジトリに報告内容を書き出さないため、トークン付きの読み取り専用 RPC
 * （docs/sql/feedback-ai-export.sql の feedback_export）を呼ぶ。
 *
 * 使い方：
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_ANON_KEY=sb_publishable_xxx \
 *   FEEDBACK_EXPORT_TOKEN=xxxxxxxx \
 *   node scripts/fetch-feedback.js [--status open|in_progress|resolved|wontfix] [--json] [--limit 100]
 *
 *   ・--status を付けるとその状態だけ。省略時は全件（解決済み/対応しないは直近10件のみ表示）
 *   ・--json は整形せず JSON のまま出力
 *   ・環境変数が無いときは使い方だけ表示して正常終了（CI を壊さない）
 *   ・秘密の値はコミットしない（SUPABASE_ANON_KEY は publishable key だが、トークンは秘密）
 */
'use strict';

const path = require('path');
const FeedbackMd = require(path.join(__dirname, '..', 'フォワーダー支援', 'js', 'feedback-md.js'));

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

async function main() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY || '';
  const token = process.env.FEEDBACK_EXPORT_TOKEN || '';
  if (!url || !key || !token) {
    console.log('SUPABASE_URL / SUPABASE_ANON_KEY / FEEDBACK_EXPORT_TOKEN を環境変数に設定してください（docs/sql/feedback-ai-export.sql 参照）。');
    return;
  }
  const limit = Number(arg('--limit', 200)) || 200;
  const res = await fetch(url + '/rest/v1/rpc/feedback_export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
    body: JSON.stringify({ p_token: token, p_limit: limit }),
  });
  if (!res.ok) {
    console.error('取得に失敗しました：HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
    process.exitCode = 1;
    return;
  }
  let rows = await res.json();
  if (!Array.isArray(rows)) rows = [];
  const st = arg('--status', '');
  if (typeof st === 'string' && st) rows = rows.filter(r => (r.status || 'open') === st);
  if (arg('--json', false)) { console.log(JSON.stringify(rows, null, 2)); return; }
  console.log(FeedbackMd.toMarkdown(rows, { title: '不具合報告一覧（フォワーダー支援）' }));
}

main().catch(e => { console.error(e && e.message ? e.message : e); process.exitCode = 1; });
