// 貿易条件・輸送モード（Design 回答 2026-11・案2）の試験。  node scripts/design-tests/cond-flow-test.js （OUT=<dir>, MODE=simple, THEME=1）
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
  ok('最初はインコタームズだけ', await vis('#cond-incoterms') && !(await vis('#dirBtns')) && !(await vis('#seaAirBtns')) && !(await vis('#cfCrumbs .cf-crumb')));
  await p.selectOption('#cond-incoterms', { label: 'FOB（本船渡し）' }); await p.waitForTimeout(200);
  ok('選ぶと要約になり、方向が開く', await vis('#cfCrumbs .cf-crumb[data-cf="inco"]') && !(await vis('#cond-incoterms')) && await vis('#dirBtns') && !(await vis('#seaAirBtns')));
  ok('要約の文言（FOB）', (await p.textContent('#cfCrumbs .cf-crumb[data-cf="inco"] b')).includes('FOB'));
  await p.click('#dirBtns [data-dir="export"]'); await p.waitForTimeout(200);
  ok('方向を選ぶと輸送モードが開く', await vis('#cfCrumbs .cf-crumb[data-cf="dir"]') && await vis('#seaAirBtns'));
  await p.click('#seaAirBtns [data-transport="fcl"]'); await p.waitForTimeout(200);
  ok('3つ選ぶと全部が 1 行の要約', (await p.$$('#cfCrumbs .cf-crumb')).length === 3 && !(await vis('#seaAirBtns')));
  ok('値は保存用の欄に入っている', await p.evaluate(() => document.getElementById('cond-direction').value === 'export' && document.getElementById('cond-mode').value === '海上（FCL）'));
  await p.click('#cfCrumbs .cf-crumb[data-cf="mode"]'); ok('要約を押すと選び直せる', await vis('#seaAirBtns'));
  await p.click('#seaAirBtns [data-transport="lcl"]'); await p.waitForTimeout(200);
  ok('選び直すと要約へ戻る（LCL）', !(await vis('#seaAirBtns')) && (await p.textContent('#cfCrumbs .cf-crumb[data-cf="mode"] b')).includes('LCL'));
  ok('保険は「＋ 保険付保（任意）」の裏', !(await vis('#insToggleBtn')) && await vis('#cfCrumbs .cf-opt'));
  await p.click('#cfCrumbs .cf-opt'); ok('押すと保険のボタンが出る', await vis('#insToggleBtn'));
  // 読み込み（値が入った状態）で要約になる
  await p.evaluate(() => { window.qpNewQuote(); }); await p.waitForTimeout(500);
  ok('新規に戻すと最初の状態へ', await vis('#cond-incoterms') && !(await vis('#cfCrumbs .cf-crumb')));
  ok('JS エラーなし', errs.length === 0, errs);
  if (process.env.OUT) { await p.selectOption('#cond-incoterms', { label: 'FOB（本船渡し）' }); await p.click('#dirBtns [data-dir="export"]'); await p.evaluate(() => document.getElementById('section-cond').scrollIntoView()); await p.screenshot({ path: path.join(process.env.OUT, 'cond-flow.png') }); }
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
