#!/usr/bin/env node
/**
 * post-email-proposals.js — AI が作った「サブコン別のメール取込ルールの案」を Supabase に送る（AI / 開発者用）
 *
 * 送り先は案の表（email_rule_proposals）だけ。ルールそのもの（マスター詳細の importRules）は書き換えない。
 * 採用するかどうかは、アプリの画面（メール取込・マスター管理のサブコン詳細）で人が決める。
 *
 * 使い方：
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… EMAIL_EXPORT_TOKEN=… node scripts/post-email-proposals.js 案.json [--dry]
 *   案.json ＝ [{ "sv": "サブコンの代表名", "kind": "alias|ignore|ccy|unit|qty_as_unit", "payload": {...}, "reason": "理由（任意）" }, ...]
 *     alias={from,to,cat?,unit?} ／ ignore={shape}（数字は 9 に伏せた形） ／ ccy={ccy:"USD"} ／ unit={unit} ／ qty_as_unit={on:true}
 *   ・案.json はリポジトリに置かない（スクラッチの場所に作る）。結果は件数だけ表示する
 *   ・SUPABASE_URL / SUPABASE_ANON_KEY を省略すると cloud-config.js の公開値を使う
 */
'use strict';
const fs = require('fs'), path = require('path');

function cloudConfig() {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'フォワーダー支援', 'js', 'quote', 'cloud-config.js'), 'utf8');
    const u = (t.match(/url\s*:\s*['"]([^'"]+)['"]/) || [])[1] || '';
    const k = (t.match(/publishableKey\s*:\s*['"]([^'"]+)['"]/) || [])[1] || '';
    return { u, k };
  } catch (e) { return { u: '', k: '' }; }
}
function check(list) {
  const KINDS = ['alias', 'ignore', 'ccy', 'unit', 'qty_as_unit'];
  const bad = [];
  list.forEach((p, i) => {
    if (!p || typeof p !== 'object') return bad.push(i + ': 形が違います');
    if (!p.sv || String(p.sv).length > 80) bad.push(i + ': sv（サブコン名）が無い／長すぎます');
    if (!KINDS.includes(p.kind)) bad.push(i + ': kind が違います');
    const s = JSON.stringify(p.payload || {}) + String(p.reason || '');
    if (/@|https?:\/\//i.test(s)) bad.push(i + ': メールアドレス・URL は入れません');
    if (p.kind === 'ignore' && /[0-8０-８]/.test(String((p.payload || {}).shape || ''))) bad.push(i + ': ignore の形は数字を 9 に伏せてください');
  });
  return bad;
}
async function main() {
  const file = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!file) { console.log('使い方：node scripts/post-email-proposals.js 案.json [--dry]'); return; }
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new Error('案.json は配列にしてください');
  const bad = check(list);
  if (bad.length) { console.error('送れない案があります：\n' + bad.join('\n')); process.exitCode = 1; return; }
  if (process.argv.includes('--dry')) { console.log('確認のみ：' + list.length + ' 件（送っていません）'); return; }
  const cc = cloudConfig();
  const url = (process.env.SUPABASE_URL || cc.u).replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY || cc.k;
  const token = process.env.EMAIL_EXPORT_TOKEN || '';
  if (!url || !key || !token) { console.log('SUPABASE_URL / SUPABASE_ANON_KEY / EMAIL_EXPORT_TOKEN を設定してください。'); return; }
  let added = 0;
  for (let i = 0; i < list.length; i += 50) {
    const res = await fetch(url + '/rest/v1/rpc/email_rule_propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
      body: JSON.stringify({ p_token: token, items: list.slice(i, i + 50) }),
    });
    if (!res.ok) { console.error('送信に失敗しました：HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200)); process.exitCode = 1; return; }
    added += Number(await res.json()) || 0;
  }
  console.log('案を送りました：' + list.length + ' 件中 ' + added + ' 件が新しい案（残りは同じ案が既にある／却下済み）');
}
main().catch(e => { console.error(e && e.message ? e.message : e); process.exitCode = 1; });
