// 選択行の一括設定欄（単位・サブコン・パターン）が、行の入力欄と同じ候補（マスター）を引ける試験。
//   node scripts/design-tests/bulk-set-list-test.js   （THEME=1 Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);
  const info = id => p.evaluate(id => { const i = document.getElementById(id); const l = i.list; return { attr: i.getAttribute('list'), has: !!l, same: l && l === document.getElementById(i.getAttribute('list')) }; }, id);
  const sv = await info('bulkSubconSet'), un = await info('bulkUnitSet'), pt = await info('bulkPatternSet');
  ok('サブコン一括設定は、サブコンのマスター候補（svSuggestions）を引く', sv.attr === 'svSuggestions' && sv.has, sv);
  ok('単位一括設定は、単位の候補（unit-list）を引く', un.attr === 'unit-list' && un.has, un);
  ok('パターン一括設定は、パターンの候補（ptSuggestions）を引く', pt.attr === 'ptSuggestions' && pt.has, pt);
  // マスターから候補が入ると、一括設定欄にも出る（行の入力欄と同じ datalist を共有）
  await p.evaluate(() => { document.getElementById('svSuggestions').innerHTML = '<option value="WAN HAI LINES"></option><option value="KMTC"></option>'; });
  ok('サブコンのマスターを追加すると、一括設定欄の候補に出る', await p.evaluate(() => [...document.getElementById('bulkSubconSet').list.options].map(o => o.value).join() === 'WAN HAI LINES,KMTC'));
  // 実際に一括設定できる
  await p.evaluate(() => { const first = document.querySelector('#tableBody tr[id^="row-"]'); first.querySelector('.row-select-chk').checked = true; });
  await p.evaluate(() => { document.getElementById('bulkSubconSet').value = 'KMTC'; window.applyBulkSubcon(); });
  ok('候補から選んだサブコンを、チェックした行へ一括設定できる', await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"] [data-field="sv"]').value === 'KMTC'));
  ok('ページエラーなし', errs.length === 0, errs);
  console.log(fails ? `\n${fails} 件 FAIL` : '\n全項目 PASS');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
