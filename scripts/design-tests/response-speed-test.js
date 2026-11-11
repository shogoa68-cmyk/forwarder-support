// 回答スピードの記録（依頼受信の時刻・初回の提示日時の自動記録・受注分析の集計・診断カード）
// 使い方: node scripts/design-tests/response-speed-test.js   （THEME=1 で Industry）
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.log('  NG  ' + n + (d ? '  → ' + d : '')); } };
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);

  // 過去案件：当日提示 10 件（8 受注）／4 日以上 10 件（2 受注）／記録なし 1 件
  const hist = [];
  const add = (id, status, recv, presentedAfterDays, time) => {
    const rc = new Date(); rc.setDate(rc.getDate() - 60);
    const pr = new Date(rc.getFullYear(), rc.getMonth(), rc.getDate() + presentedAfterDays, 15, 0, 0);
    const f = { 'qf-received': ymd(rc) };
    if (time) f['qf-recv-time'] = time;
    if (presentedAfterDays != null) f['qf-first-presented'] = pr.toISOString();
    hist.push({ id, customer: '客' + id, status, transport_mode: '海上輸送', updated_at: new Date().toISOString(), created_by: 'a@x', data: { fields: f, rows: [] } });
  };
  for (let i = 0; i < 10; i++) add('f' + i, i < 8 ? '受注' : '失注', 0, 0, '13:00');
  for (let i = 0; i < 10; i++) add('s' + i, i < 2 ? '受注' : '失注', 0, 5);
  // 提示履歴だけある古い案件（qf-first-presented 無し）→ 最初の版の時刻から計算される
  { const rc = new Date(); rc.setDate(rc.getDate() - 60); hist.push({ id: 'old', customer: '古', status: '受注', transport_mode: '海上輸送', updated_at: new Date().toISOString(), created_by: 'a@x', data: { fields: { 'qf-received': ymd(rc), 'qf-versions': JSON.stringify([{ v: 1, ts: new Date(rc.getFullYear(), rc.getMonth(), rc.getDate() + 1, 10).toISOString() }]) }, rows: [] } }); }
  hist.push({ id: 'none', customer: '無', status: '失注', transport_mode: '海上輸送', updated_at: new Date().toISOString(), created_by: 'a@x', data: { fields: {}, rows: [] } });
  await p.evaluate(h => { window.cloudGetAllRows = () => h; }, hist);

  // --- 受注分析タブ ---
  await p.evaluate(() => { switchTab('stats', document.querySelector('.cat-btn[aria-controls="tab-stats"]')); statsSetPane('winrate'); }); await p.waitForTimeout(800);
  const wr = await p.evaluate(() => document.getElementById('statsPane-winrate').innerText);
  ok('「回答スピード別の受注率」の表が出る', /回答スピード別の受注率/.test(wr));
  const rows = await p.evaluate(() => [...document.querySelectorAll('#statsPane-winrate h3')].filter(h => /回答スピード/.test(h.textContent)).map(h => { let e = h.nextElementSibling; while (e && e.tagName !== 'TABLE') e = e.nextElementSibling; return e ? [...e.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.innerText.replace(/\s+/g, ' ').trim())) : []; })[0] || []);
  const by = l => rows.find(r => r[0].startsWith(l));
  ok('当日中：10件・受注8', by('当日中') && by('当日中')[1] === '10' && by('当日中')[2] === '8', JSON.stringify(rows));
  ok('翌日：履歴だけの古い案件が 1 件入る', by('翌日') && by('翌日')[1] === '1', JSON.stringify(rows));
  ok('4日以上：10件・受注2', by('4日以上') && by('4日以上')[1] === '10' && by('4日以上')[2] === '2', JSON.stringify(rows));
  ok('受信時刻つきの当日提示の平均所要時間（120分）', /平均 120 分/.test(wr), wr.slice(wr.indexOf('回答スピード'), wr.indexOf('回答スピード') + 300));

  // --- 見積入力：受信 → 経過表示 → 提示で自動記録 ---
  await p.evaluate(() => switchTab('quote-make', document.querySelector('.cat-btn[aria-controls="tab-quote-make"]'))); await p.waitForTimeout(800);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(400);
  const d2 = new Date(); d2.setDate(d2.getDate() - 3);
  await p.evaluate(v => { const q = (id, x) => { const e = document.getElementById(id); e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }; q('qf-received', v); q('qf-recv-time', '09:00'); }, ymd(d2));
  await p.waitForTimeout(300);
  let hint = await p.evaluate(() => { const h = document.getElementById('ciRespHint'); return h.hidden ? '[hidden]' : h.textContent; });
  ok('提示前は経過日数を表示', /受信から 3日経過/.test(hint), hint);
  // 診断カードにも出る（明細を入れる）
  await p.evaluate(() => qspSetTab('fin'));
  const f = (n, i) => p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).nth(i);
  await f('nm', 0).fill('海上運賃'); await f('pq', 0).fill('1'); await f('pp', 0).fill('100000'); await f('mk', 0).fill('10000'); await p.waitForTimeout(800);
  const dg = await p.evaluate(() => document.getElementById('qspDiag').textContent);
  ok('診断カードに経過日数と過去の受注率', /3 日経過/.test(dg) && /82%（11 件）/.test(dg) && /20%（10 件）/.test(dg), dg);
  const before = await p.evaluate(() => document.getElementById('qf-first-presented').value);
  ok('提示前は初回提示日時が空', before === '');
  await p.evaluate(() => setQuoteStatus('提示済み')); await p.waitForTimeout(300);
  const fp = await p.evaluate(() => document.getElementById('qf-first-presented').value);
  ok('提示済みにすると初回の提示日時が自動で入る', !!fp && !isNaN(new Date(fp)), fp);
  hint = await p.evaluate(() => document.getElementById('ciRespHint').textContent);
  ok('提示後は「初回の提示まで 3日」', /初回の提示まで 3日/.test(hint), hint);
  await p.evaluate(() => { setQuoteStatus('改定中'); setQuoteStatus('提示済み'); }); await p.waitForTimeout(200);
  ok('改定して再提示しても初回の日時は変わらない', (await p.evaluate(() => document.getElementById('qf-first-presented').value)) === fp);
  // 保存データへの往復
  const rt = await p.evaluate(() => { const d = gatherAllData(); const keep = [d.fields['qf-first-presented'], d.fields['qf-recv-time']]; ['qf-first-presented', 'qf-recv-time'].forEach(k => { document.getElementById(k).value = ''; }); _applyQuoteData(d); return [keep, document.getElementById('qf-first-presented').value, document.getElementById('qf-recv-time').value]; });
  ok('案件データに保存され、開き直すと復元', rt[0][0] === rt[1] && rt[0][1] === '09:00' && rt[2] === '09:00', JSON.stringify(rt));
  // 古い案件（フィールド無し）を開くと前の案件の値が残らない
  const old = await p.evaluate(() => { const d = gatherAllData(); delete d.fields['qf-first-presented']; delete d.fields['qf-recv-time']; _applyQuoteData(d); return [document.getElementById('qf-first-presented').value, document.getElementById('qf-recv-time').value]; });
  ok('フィールドの無い案件を開くと空に戻る', old[0] === '' && old[1] === '', JSON.stringify(old));
  ok('ページエラーなし', errs.length === 0, JSON.stringify(errs));
  await b.close(); srv.close();
  console.log(`\n${pass} 項目 OK / ${fail} 件 NG`); process.exit(fail ? 1 : 0);
})();
