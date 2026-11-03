// 出力の合計：外貨が混じる見積で、メール本文の消費税が御見積書PDFと同じ（JPY建ての課税行だけ・行ごと切り上げ）こと、
// クリップボードコピー(TSV)の利益合計が JPY 換算になっていることを確かめる。架空データ・外部接続なし。
//   node scripts/design-tests/output-fx-total-test.js
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
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  p.setDefaultTimeout(10000);
  const ok = (n, c, d) => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
  await p.evaluate(() => { window.__clip = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } }); });
  const ids = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(t => t.id.replace('row-', '')));
  const fill = async (id, o) => {
    await p.fill('#nm-' + id, o.nm);
    await p.selectOption('#pc-' + id, o.cur);
    await p.fill('#pq-' + id, '1'); await p.dispatchEvent('#pq-' + id, 'input');
    await p.fill('#pp-' + id, String(o.pp)); await p.dispatchEvent('#pp-' + id, 'input');
    await p.fill('#mk-' + id, String(o.mk)); await p.dispatchEvent('#mk-' + id, 'input');
    if (!(await p.isChecked('#tx-' + id))) await p.check('#tx-' + id);
  };
  let list = await ids();
  await fill(list[0], { nm: '国内トラック', cur: 'JPY', pp: 700, mk: 333 });
  await p.evaluate(() => addRow()); await p.waitForTimeout(300);
  list = await ids();
  await fill(list[list.length - 1], { nm: 'Ocean Freight', cur: 'USD', pp: 10, mk: 5 });
  await p.waitForTimeout(400);
  const exp = await p.evaluate(() => {
    const rows = collectAllRows().filter(r => r._type === 'data' && !r._hideQuote);
    let taxable = 0, exempt = 0, tax = 0, pr = 0;
    rows.forEach(r => {
      const jpy = Math.ceil(toJPY(r.bill, r.bc));
      if (r.taxed && r.bc === 'JPY') { taxable += jpy; tax += Math.ceil(jpy * 0.1); } else exempt += jpy;
      pr += jpy - Math.ceil(toJPY(r.cost, r.pc));
    });
    return { total: taxable + exempt + tax, tax, pr, n: rows.length, usdJpy: toJPY(1, 'USD') };
  });
  ok('準備：2 行（JPY と USD）', exp.n === 2 && exp.usdJpy > 1, exp);
  await p.evaluate(() => copyQuoteEmail()); await p.waitForTimeout(400);
  const mail = await p.evaluate(() => window.__clip);
  const yen = n => '¥' + n.toLocaleString('ja-JP');
  const pick = re => mail.split('\n').filter(l => re.test(l));
  ok('メール本文の消費税は JPY 建て課税行だけ（御見積書PDFと同じ）', pick(/消費税/).some(l => l.trim().endsWith(yen(exp.tax))), pick(/消費税/));
  ok('メール本文の御見積額が PDF と同じ計算', pick(/御見積額/).some(l => l.trim().endsWith(yen(exp.total))), pick(/御見積額/));
  await p.evaluate(() => { window.__clip = ''; copyTSV(); if (!window.__clip && typeof pvWarnGuideSkip === 'function') pvWarnGuideSkip(); }); await p.waitForTimeout(400);
  const tsv = await p.evaluate(() => window.__clip);
  const tot = tsv.split('\n').find(l => l.startsWith('合計'));
  ok('コピー(TSV)の合計行は外貨混在のとき「≈JPY換算」と明記', !!tot && tot.startsWith('合計（≈JPY換算）'), tot);
  ok('コピー(TSV)の利益合計が JPY 換算の値', !!tot && tot.split('\t').includes(String(exp.pr)), { tot, expected: exp.pr });
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
})();
