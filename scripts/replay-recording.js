#!/usr/bin/env node
/**
 * replay-recording.js — 見張り番の報告（再現手順つき）をブラウザで自動再生して、再現するか確かめる
 *
 *   node scripts/replay-recording.js --file <報告の本文.txt> [--init "qpNewQuote()"] [--url <外部URL>] [--json]
 *   cat 報告.txt | node scripts/replay-recording.js [--init ...]
 *
 *  ・手順は本文の「【再現手順（自動記録）】」を読む（scripts/lib/recording-steps.js）。
 *  ・金額は 9 に伏せてあるため、数値は 5 に置き換えて入力する（桁数は同じ）。文字は「x」の繰り返し、日付は今日。
 *  ・記録の最初の画面（開いていた案件など）は再現できないので、必要なら --init で用意する
 *    （例：--init "qpNewQuote()" で新しい見積を開いた状態から始める）。ログインが要る操作は、この環境では動かない。
 *  ・--eval "<JS式>" を付けると、再生の最後にその式を画面で評価して結果を出す（例：行の値の確認）。
 *  ・--url を省くと、このリポジトリの フォワーダー支援/index.html を一時サーバーで開く。
 *  ・結果：手順ごとの ✅/❌、再生中に出たエラー・通知、記録されていたエラー／通知との照合（再現した／できず）。
 *  ・終了コード：0＝最後まで実行できた／1＝手順が実行できなかった所がある／2＝使い方の誤り
 */
'use strict';

const fs = require('fs'), path = require('path'), http = require('http');
const { parseReport, FIELD_BY_LABEL } = require('./lib/recording-steps');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
function readStdin() {
  return new Promise(res => { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => (s += d)); process.stdin.on('end', () => res(s)); });
}
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const head = (s, n) => norm(s).slice(0, n);                       // 照合用（小文字にそろえる）
const show = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);   // 表示用（元の文字のまま）

function placeholder(step) {
  switch (step.vkind) {
    case 'number': return String(step.value).replace(/9/g, '5');
    case 'chars': return 'x'.repeat(Math.max(1, Math.min(Number(step.value) || 1, 200)));
    case 'date': return new Date().toISOString().slice(0, 10);
    case 'empty': return '';
    default: return String(step.value);
  }
}

async function main() {
  const file = arg('--file', '');
  let body = '';
  if (file && file !== true) body = fs.readFileSync(file, 'utf8');
  else if (!process.stdin.isTTY) body = await readStdin();
  if (!body.trim()) { console.error('報告の本文がありません。--file <本文.txt> か標準入力で渡してください。'); process.exit(2); }
  const rep = parseReport(body);
  if (!rep.steps.length) { console.error('「【再現手順（自動記録）】」の手順が見つかりません（見張り番の報告ではありません）。'); process.exit(2); }
  const asJson = !!arg('--json', false);
  const init = arg('--init', '');

  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('playwright')); }

  // 一時サーバー（--url が無いとき）
  let srv = null, URL = arg('--url', '');
  if (!URL || URL === true) {
    const root = path.resolve(__dirname, '..');
    srv = http.createServer((q, r) => {
      const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
      fs.createReadStream(f).pipe(r);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('fbFabHintDone_v1', '1'); } catch (e) {}
    window.__replayToasts = [];
    const wrap = () => {
      if (typeof window.quoteShowToast === 'function' && !window.quoteShowToast.__w) {
        const o = window.quoteShowToast;
        const w = function (m, t) { try { window.__replayToasts.push({ type: t || 'info', msg: String(m) }); } catch (e) {} return o.apply(this, arguments); };
        w.__w = true; window.quoteShowToast = w;
      }
    };
    const iv = setInterval(wrap, 100); setTimeout(() => clearInterval(iv), 15000); wrap();
  });
  if (!arg('--online', false)) await ctx.route(u => !u.href.startsWith('http://127.0.0.1') && !u.href.startsWith(URL.split('/').slice(0, 3).join('/')), r => r.abort());
  const page = await ctx.newPage();
  const errors = [];     // { step, msg }
  let cur = 0;
  page.on('pageerror', e => errors.push({ step: cur, msg: String(e && e.message || e) }));
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/Failed to load resource|net::ERR/.test(t)) errors.push({ step: cur, msg: t }); } });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fbQuickFab', { state: 'attached', timeout: 15000 }).catch(() => {});
  if (init && init !== true) { try { await page.evaluate(init); await page.waitForTimeout(400); } catch (e) { console.error('--init の実行に失敗：' + e.message); } }

  const rowLoc = n => page.locator('#tableBody tr[id^="row-"]:not([data-virtual="1"])').nth(n - 1);
  const results = [];

  async function targetOf(s) {
    // 明細の欄（ラベル→data-field）
    if (s.row && FIELD_BY_LABEL[s.label]) return rowLoc(s.row).locator('[data-field="' + FIELD_BY_LABEL[s.label] + '"]').first();
    if (s.id) return page.locator('#' + s.id).first();
    const label = s.label.replace(/…$/, '');
    if (s.kind === 'click') {
      const scope = s.row ? rowLoc(s.row) : page;
      return scope.locator('button, a, summary, [role="button"], .cat-btn, label').filter({ hasText: label }).first();
    }
    return page.getByLabel(label).first();
  }

  for (const s of rep.steps) {
    cur = s.n;
    const r = { n: s.n, t: s.t, kind: s.kind, ok: true, note: '' };
    try {
      if (s.kind === 'click') {
        const loc = await targetOf(s);
        for (let k = 0; k < Math.min(s.times, 3); k++) await loc.click({ timeout: 3000 });
        r.note = '押した';
      } else if (s.kind === 'input') {
        const loc = await targetOf(s);
        if (s.vkind === 'onoff') { await (s.value ? loc.check({ timeout: 3000 }) : loc.uncheck({ timeout: 3000 })); r.note = s.value ? 'ONにした' : 'OFFにした'; }
        else { const v = placeholder(s); await loc.fill(v, { timeout: 3000 }); await loc.press('Tab', { timeout: 3000 }).catch(() => {}); r.note = '入力：' + (v.length > 24 ? v.slice(0, 24) + '…' : v); }
      } else if (s.kind === 'select') {
        const loc = await targetOf(s);
        await loc.selectOption({ label: s.value }, { timeout: 3000 });
        r.note = '選んだ：' + s.value;
      } else if (s.kind === 'key') {
        await page.keyboard.press(s.key.replace(/\bCtrl\b/g, 'Control').replace(/\bCmd\b/g, 'Meta'));   // 記録の表記 → Playwright の表記
        r.note = 'キー：' + s.key;
      } else if (s.kind === 'reload') {
        await page.reload({ waitUntil: 'domcontentloaded' }); r.note = '再読み込み';
      } else if (s.kind === 'mark') {
        r.note = '🚩 不具合に気づいた時点';
        r.snapshot = await page.evaluate(() => ({ tab: ((document.querySelector('.tab-content.active') || {}).id || '').replace(/^tab-/, ''), rows: document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual="1"])').length, toasts: (window.__replayToasts || []).slice(-3) }));
      } else if (s.kind === 'toast' || s.kind === 'error') {
        r.note = '（記録された出来事・再生はしない）';
        r.skipped = true;
      } else {
        r.ok = false; r.note = '読み取れない手順：' + (s.text || '');
      }
    } catch (e) {
      r.ok = false; r.note = String(e && e.message || e).split('\n')[0].slice(0, 160);
    }
    results.push(r);
    await page.waitForTimeout(120);
  }

  const toasts = await page.evaluate(() => (window.__replayToasts || []).slice()).catch(() => []);
  const evalExpr = arg('--eval', '');
  let evalOut;
  if (evalExpr && evalExpr !== true) { try { evalOut = await page.evaluate(evalExpr); } catch (e) { evalOut = '評価に失敗：' + e.message; } }
  await browser.close();
  if (srv) srv.close();

  // 照合：記録されていたエラー・通知が、再生でも出たか
  const recordedErrors = rep.steps.filter(s => s.kind === 'error').map(s => s.msg).concat(rep.errors);
  const recordedToasts = rep.steps.filter(s => s.kind === 'toast');
  const seenErr = e => errors.some(x => head(x.msg, 40).includes(head(e, 40)) || head(e, 40).includes(head(x.msg, 40)));
  const seenToast = t => toasts.some(x => head(x.msg, 30) === head(t.msg, 30) || head(x.msg, 30).includes(head(t.msg, 30).slice(0, 20)));
  const errHit = Array.from(new Set(recordedErrors)).map(e => ({ msg: e, seen: seenErr(e) }));
  const toastHit = recordedToasts.filter(t => t.type !== 'info' && t.type !== 'success').map(t => ({ type: t.type, msg: t.msg, seen: seenToast(t) }));
  const failed = results.filter(r => !r.ok);
  const anyHit = errHit.some(x => x.seen) || toastHit.some(x => x.seen);
  const anyRecorded = errHit.length + toastHit.length;
  const verdict = !anyRecorded ? '記録に「エラー・警告」が無い（画面の動きそのものの不具合。🚩の時点の状態と【起きたこと】を目で比べる）'
    : (errHit.concat(toastHit).every(x => x.seen) ? '再現した（記録されていたエラー・警告が、再生でも出た）'
      : anyHit ? '一部再現（記録されていたエラー・警告の一部だけ出た）'
        : '再現できず（記録されていたエラー・警告は、再生では出なかった）');

  const out = { url: URL, steps: results, failedSteps: failed.length, errors, toasts, recorded: { errors: errHit, toasts: toastHit }, verdict, eval: evalOut };
  if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(failed.length ? 1 : 0); }

  const L = [];
  L.push('# 再現の自動再生');
  L.push('');
  L.push('開いた場所：' + URL.replace(/^http:\/\/127\.0\.0\.1:\d+/, '（一時サーバー）') + (init && init !== true ? ' ／ 最初に実行：`' + init + '`' : ''));
  L.push('手順：' + results.length + ' 件中 ' + (results.length - failed.length) + ' 件を実行できた' + (failed.length ? '（❌ ' + failed.length + ' 件）' : ''));
  L.push('');
  results.forEach(r => L.push((r.ok ? (r.skipped ? '➖ ' : '✅ ') : '❌ ') + r.n + '. [' + r.kind + '] ' + r.note));
  L.push('');
  L.push('## 再生中に出たエラー（' + errors.length + ' 件）');
  errors.slice(0, 12).forEach(e => L.push('- 手順' + e.step + '：' + show(e.msg, 160)));
  if (!errors.length) L.push('（なし）');
  L.push('');
  L.push('## 再生中に出た通知（' + toasts.length + ' 件）');
  toasts.slice(0, 12).forEach(t => L.push('- （' + t.type + '）' + show(t.msg, 120)));
  if (!toasts.length) L.push('（なし）');
  L.push('');
  L.push('## 記録との照合');
  errHit.forEach(x => L.push('- ' + (x.seen ? '✅ 出た' : '➖ 出なかった') + '：エラー「' + show(x.msg, 100) + '」'));
  toastHit.forEach(x => L.push('- ' + (x.seen ? '✅ 出た' : '➖ 出なかった') + '：通知（' + x.type + '）「' + show(x.msg, 80) + '」'));
  if (!anyRecorded) L.push('（記録されたエラー・警告はありません）');
  L.push('');
  L.push('**判定：' + verdict + '**');
  if (evalOut !== undefined) { L.push(''); L.push('## 最後の画面の確認（--eval）'); L.push('`' + JSON.stringify(evalOut) + '`'); }
  if (failed.length) { L.push(''); L.push('※ ❌ の手順は、記録の最初の画面（開いていた案件・ログイン状態）が再現できていない可能性があります。`--init` で状態を用意してください。'); }
  console.log(L.join('\n'));
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(2); });
