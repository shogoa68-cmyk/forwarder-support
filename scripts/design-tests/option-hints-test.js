// 行の［その他 ▾］の設定ボタンの説明バー（Design 36 案P）の確認
//   node scripts/design-tests/option-hints-test.js      （THEME=1 で Industry・W=390 でスマホ幅）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const W = +process.env.W || 1400;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
  await ctx.addInitScript(t => { try { localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: t, doc: t })); } catch (e) {} }, !!process.env.THEME);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => { window.qpNewQuote(); }); await p.waitForTimeout(900);
  await p.evaluate(() => { window.addRow && window.addRow(); }); await p.waitForTimeout(300);
  // パネル（Industry）か、行の中（現行）のボタン列
  await p.evaluate(() => { const bt = document.querySelector('#tableBody tr .row-detail-btn'); if (bt) bt.click(); }); await p.waitForTimeout(300);
  const info = () => p.evaluate(() => { const g = document.querySelector('#tableBody tr .row-mode-btns'); const bar = g && g.querySelector(':scope > .mode-hint'); if (!bar) return null; const r = bar.getBoundingClientRect(); return { text: bar.textContent, h: Math.round(r.height), w: Math.round(r.width), idle: !!bar.querySelector('.mh-idle'), touched: Array.from(g.querySelectorAll(':scope > button.is-touch')).map(x => x.textContent.trim()) }; });
  const i0 = await info();
  ok('ボタン列の下に説明バーが 1 つある', !!i0, i0);
  ok('何も触れていないときは「ボタンを押すと、ここに説明が出ます」', i0 && /ボタンを押すと、ここに説明が出ます/.test(i0.text), i0);
  const ps = '#tableBody tr .row-mode-btns > .profit-share-btn';
  await p.evaluate(s => document.querySelector(s).dispatchEvent(new PointerEvent('pointerover', { bubbles: true })), ps);
  const i1 = await info();
  ok('乗せる（pointerover）と、そのボタンの説明（title）が出る', i1 && /PS/.test(i1.text) && /代理店収益/.test(i1.text), i1);
  ok('触れているボタンに印（青い枠）が付く', i1 && i1.touched.length === 1 && /PS/.test(i1.touched[0]), i1);
  await p.evaluate(() => document.querySelector('#tableBody tr .row-mode-btns > .est-btn').dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
  const i2 = await info();
  ok('フォーカスでも入れ替わる（概算）・印は 1 つだけ', i2 && /概算/.test(i2.text) && i2.touched.length === 1 && /概算/.test(i2.touched[0]), i2);
  ok('説明バーの高さは入れ替えても変わらない', i0.h === i1.h && i1.h === i2.h, [i0.h, i1.h, i2.h]);
  const before = await p.evaluate(s => document.querySelector(s).classList.contains('is-on') || document.querySelector(s).classList.contains('active') || document.querySelector(s).getAttribute('aria-pressed'), ps);
  await p.evaluate(s => document.querySelector(s).click(), ps);
  const after = await p.evaluate(s => document.querySelector(s).classList.contains('is-on') || document.querySelector(s).classList.contains('active') || document.querySelector(s).getAttribute('aria-pressed'), ps);
  const i3 = await info();
  ok('押すと説明は PS のまま・ON/OFF（元の動き）も壊れない', i3 && /PS/.test(i3.text) && (before !== after || (await p.evaluate(() => document.querySelector('#tableBody tr').classList.contains('is-profit-share') || document.querySelector('#tableBody tr').dataset.profitShare != null))), { before, after, i3 });
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
