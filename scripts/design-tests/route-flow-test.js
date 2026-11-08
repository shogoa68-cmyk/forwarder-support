// 幹線輸送（Design 回答 2026-11）の試験。  node scripts/design-tests/route-flow-test.js （OUT=<dir>, MODE=simple, THEME=1）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript((mode) => { try { localStorage.setItem('fwd.uiMode', mode); } catch (e) {} }, process.env.MODE || 'detail');
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { try { window.qpNewQuote(); } catch (e) {} }); await p.waitForTimeout(600);
  const vis = s => p.evaluate(x => { const e = document.querySelector(x); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, s);
  ok('POL／POD は最初から見える', await vis('#z2Pol') && await vis('#z2Pod'));
  ok('経由地・キャリア・サービス・T/T は隠れている', !(await vis('#z2Via')) && !(await vis('#z2Carrier')) && !(await vis('#z2Service')) && !(await vis('#z2Tt')));
  ok('「＋」の入口が出ている', await vis('#z2ViaBtn') && await vis('#z2CarrierOptBtn'));
  await p.click('#z2ViaBtn'); ok('経由地を追加すると入力欄が出る', await vis('#z2Via') && !(await vis('#z2ViaBtn')));
  await p.click('#z2CarrierOptBtn'); ok('キャリア等を開くと 4 欄が出る', await vis('#z2Carrier') && await vis('#z2Service') && await vis('#z2Tt'));
  ok('役割・実運送人は奥', !(await vis('#z2ActualCarrier')) && await vis('#z2RelayBtn'));
  await p.click('#z2RelayBtn'); ok('役割・実運送人を開く', await vis('#z2ActualCarrier') && await vis('#z2CarrierRole'));
  await p.fill('#z2Carrier', 'ONE'); await p.fill('#z2Pol', 'Yokohama'); await p.fill('#z2Pod', 'Shanghai'); await p.fill('#z2Tt', '14 days');
  await p.evaluate(() => addRouteEntry()); await p.waitForTimeout(300);
  ok('航路を追加できる', await p.evaluate(() => document.querySelectorAll('#z2RouteList > *').length >= 1));
  ok('PODがPOLより下（縦の流れ）', await p.evaluate(() => document.getElementById('z2Pod').getBoundingClientRect().top > document.getElementById('z2Pol').getBoundingClientRect().top + 20));
  const saved = await p.evaluate(() => ({ c: document.getElementById('z2Carrier').value, v: document.getElementById('z2-routes-data').value.length }));
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(500); if (process.env.OUT) { await p.evaluate(() => document.getElementById('section-cond').scrollIntoView()); await p.screenshot({ path: require('path').join(process.env.OUT, 'route-flow.png') }); }
  ok('新規に戻すと最初の状態（キャリア等は隠れる）', !(await vis('#z2Carrier')) && await vis('#z2CarrierOptBtn'));
  ok('JS エラーなし', errs.length === 0, errs);
  if (process.env.OUT) { await p.evaluate(() => document.getElementById('section-cond').scrollIntoView()); await p.screenshot({ path: path.join(process.env.OUT, 'route-flow.png') }); }
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
