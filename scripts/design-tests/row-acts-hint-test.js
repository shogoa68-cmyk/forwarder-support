// 明細 1 行の操作は、行の左端の「⋯」の目印にマウスを乗せると出る。  node scripts/design-tests/row-acts-hint-test.js  （THEME=1／EDITOR=v2）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(([t, v2]) => { try { localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: t, doc: t })); localStorage.setItem('fwd.editorV2', v2 ? '1' : '0'); } catch (e) {} }, [!!process.env.THEME, process.env.EDITOR === 'v2']);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(900);
  if (process.env.EDITOR === 'v2') await p.evaluate(() => window.editorV2Go(4));
  await p.evaluate(() => window.addRow()); await p.waitForTimeout(400);
  const hint = await p.evaluate(() => { const h = document.querySelector('#tableBody tr:not([data-virtual]) .row-acts-hint'); if (!h) return null; const r = h.getBoundingClientRect(), c = getComputedStyle(h); return { w: Math.round(r.width), h: Math.round(r.height), vis: c.visibility, disp: c.display, text: h.textContent }; });
  ok('行の左端に「⋯」の目印がいつも見える', hint && hint.vis === 'visible' && hint.disp !== 'none' && hint.w > 10, hint);
  if (process.env.EDITOR === 'v2') {
    // Design 50（案A）：新しい画面では、右端の［⋯］を押すとメニュー（行の詳細・複製・入力完了・削除など）が開く
    await p.evaluate(() => document.querySelector('#tableBody tr.ca-row .row-acts-hint').click()); await p.waitForTimeout(200);
    const mi = await p.evaluate(() => [...document.querySelectorAll('.ca-menu .ca-mi')].map(x => x.textContent));
    ok('［⋯］を押すと 行の詳細・複製・入力完了・削除 のメニュー', ['行の詳細', '⧉ 複製', '削除'].every(t => mi.includes(t)) && mi.some(t => /入力完了/.test(t)), mi);
    ok('JS エラーなし', errs.length === 0, errs);
    await b.close(); srv.close(); console.log(fails ? '\nFAIL=' + fails : '\nALL PASS'); process.exit(fails ? 1 : 0);
  }
  const acts = () => p.evaluate(() => { const bt = document.querySelector('#tableBody tr:not([data-virtual]) .row-del-btn'); const c = getComputedStyle(bt), r = bt.getBoundingClientRect(); return { vis: c.visibility, r: r.width > 0 }; });
  const before = await acts();
  ok('何もしないときは操作ボタンは隠れている', before.vis === 'hidden' || !before.r, before);
  await p.hover('#tableBody tr:not([data-virtual]) .row-acts-hint'); await p.waitForTimeout(500);
  const after = await acts();
  ok('「⋯」に乗せると 複製・削除などが出る', after.vis === 'visible' && after.r, after);
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
