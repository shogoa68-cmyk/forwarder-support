// ミニマム（最低料金：「Min. $28.00 or $0.15/kg」）の試験。架空データ・外部接続なし。
//   node scripts/design-tests/min-charge-test.js        （THEME=1 で Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  p.setDefaultTimeout(10000);
  const out = [];
  const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));

  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);

  const id = await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').id.replace('row-', ''));
  // 航空運賃：100 kg × USD 0.10（仕入）＋ 0.05（乗せ幅）＝ 0.15（売）
  await p.fill('#nm-' + id, 'Air Freight');
  await p.fill('#un-' + id, 'kg');
  await p.selectOption('#pc-' + id, 'USD');
  await p.fill('#pq-' + id, '100'); await p.dispatchEvent('#pq-' + id, 'input');
  await p.fill('#pp-' + id, '0.1'); await p.dispatchEvent('#pp-' + id, 'input');
  await p.fill('#mk-' + id, '0.05'); await p.dispatchEvent('#mk-' + id, 'input');
  await p.waitForTimeout(200);
  const before = await p.evaluate(id => document.querySelector('#row-' + id + ' td.subtotal-cell .st-main').textContent.trim(), id);
  ok('ミニマムなし：小計＝100 × 0.15 ＝ 15', before === '15', before);

  // MIN を ON にして、仕入 25・売値 28 を入れる
  await p.evaluate(id => toggleMinMode(id), id); await p.waitForTimeout(200);
  const vis = await p.evaluate(id => !!document.getElementById('bpmin-' + id).offsetParent, id);
  ok('MIN を押すと最低料金の欄が出る', vis, vis);
  await p.fill('#ppmin-' + id, '25'); await p.dispatchEvent('#ppmin-' + id, 'input');
  await p.fill('#bpmin-' + id, '28'); await p.dispatchEvent('#bpmin-' + id, 'input');
  await p.waitForTimeout(400);
  const r1 = await p.evaluate(id => {
    const tr = document.getElementById('row-' + id);
    return {
      sub: tr.querySelector('td.subtotal-cell .st-main').textContent.trim(),
      profit: tr.querySelector('td.profit-cell .pr-main').textContent.trim(),
      applied: tr.dataset.minApplied, chip: (tr.querySelector('.st-state') || {}).textContent || '',
      btnOn: tr.querySelector('.min-mode-btn').classList.contains('is-on'),
    };
  }, id);
  ok('最低料金が上回る：小計＝28（売の最低料金）', r1.sub === '28', r1);
  ok('利益＝28 − 25（仕入の最低料金）＝ 3', r1.profit === '3', r1);
  ok('MIN 適用の印', r1.applied === '1' && r1.btnOn, r1);
  if (process.env.THEME) ok('状態チップ「MIN 適用」', r1.chip.includes('MIN 適用'), r1);

  if (process.env.OUT) {   // OUT=<dir>：行（MIN 適用中）と御見積書の画像
    if (process.env.THEME) await p.evaluate(id => window.rowDetailToggle && window.rowDetailToggle(document.getElementById('row-' + id), true), id);
    await p.waitForTimeout(300);
    await p.locator('#row-' + id).screenshot({ path: path.join(process.env.OUT, 'min-row.png') });
    if (process.env.THEME) await p.evaluate(id => window.rowDetailToggle && window.rowDetailToggle(document.getElementById('row-' + id), false), id);
    await p.evaluate(() => window.openQuoteDoc && window.openQuoteDoc()); await p.waitForTimeout(1200);
    const doc = p.locator('#quoteDocOverlay tr', { hasText: 'Air Freight' }).first();
    if (await doc.count()) await doc.screenshot({ path: path.join(process.env.OUT, 'min-doc-row.png') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    await p.evaluate(() => { const o = document.getElementById('quoteDocOverlay'); if (o) o.classList.remove('open'); });
  }
  // 出力：プレビュー用の行データ・単価の表示・メール本文
  const r2 = await p.evaluate(() => {
    const d = collectAllRows().find(x => x._type === 'data' && x.name === 'Air Freight');
    return { bill: d.bill, cost: d.cost, text: minPriceText(d.bp, d.bpmin, d.bc, d.un), costText: minPriceText(d.pp, d.ppmin, d.pc, d.un) };
  });
  ok('出力の金額（請求 28・仕入 25）', r2.bill === 28 && r2.cost === 25, r2);
  ok('単価の表示「Min. $28.00 or $0.15/kg」', r2.text === 'Min. $28.00 or $0.15/kg', r2);
  ok('仕入側の表示「Min. $25.00 or $0.10/kg」', r2.costText === 'Min. $25.00 or $0.10/kg', r2);
  // メール本文：コピー機能で作られた本文を、クリップボードへの書き込みを横取りして確かめる
  const mail = await p.evaluate(async () => {
    let got = '';
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { got = t; return Promise.resolve(); } } }); } catch (e) {}
    window.copyQuoteEmail();
    await new Promise(r => setTimeout(r, 300));
    return got;
  });
  ok('メール本文に Min 表記（通貨・単位を重ねない）', mail.includes('Min. $28.00 or $0.15/kg') && !mail.includes('Min. $28.00 or $0.15/kg | kg'), mail.split('\n').filter(l => /Air/.test(l)));

  // 数量が増えて「数量 × 単価」が上回る：300 kg × 0.15 ＝ 45
  await p.fill('#pq-' + id, '300'); await p.dispatchEvent('#pq-' + id, 'input'); await p.waitForTimeout(300);
  const r3 = await p.evaluate(id => ({ sub: document.querySelector('#row-' + id + ' td.subtotal-cell .st-main').textContent.trim(), applied: document.getElementById('row-' + id).dataset.minApplied }), id);
  ok('数量 × 単価が上回る：小計＝45、MIN 適用なし', r3.sub === '45' && !r3.applied, r3);

  // 保存 → 復元
  await p.fill('#pq-' + id, '100'); await p.dispatchEvent('#pq-' + id, 'input'); await p.waitForTimeout(200);
  const saved = await p.evaluate(() => JSON.stringify(gatherAllData()));
  await p.evaluate(s => _applyQuoteData(JSON.parse(s)), saved); await p.waitForTimeout(800);
  const r4 = await p.evaluate(() => {
    const tr = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type])')].find(t => document.getElementById('nm-' + t.id.slice(4)).value === 'Air Freight');
    const i = tr.id.slice(4);
    return { ppmin: document.getElementById('ppmin-' + i).value, bpmin: document.getElementById('bpmin-' + i).value, sub: tr.querySelector('td.subtotal-cell .st-main').textContent.trim(), mode: tr.classList.contains('row-min-mode') };
  });
  ok('保存・復元で最低料金と計算が戻る', r4.ppmin === '25' && r4.bpmin === '28' && r4.sub === '28' && r4.mode, r4);

  // OFF：最低料金を消して通常に戻す
  const id2 = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type])')].find(t => document.getElementById('nm-' + t.id.slice(4)).value === 'Air Freight').id.slice(4));
  await p.evaluate(id => toggleMinMode(id), id2); await p.waitForTimeout(300);
  const r5 = await p.evaluate(id => ({ sub: document.querySelector('#row-' + id + ' td.subtotal-cell .st-main').textContent.trim(), bpmin: document.getElementById('bpmin-' + id).value }), id2);
  ok('MIN を OFF：最低料金を消して小計＝15', r5.sub === '15' && r5.bpmin === '', r5);
  ok('JS エラーなし', errs.length === 0, errs);

  console.log(out.join('\n'));
  console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close();
  process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
