// 画面の幅を変えたとき、要らない書き換え（同じ値の hidden・ドックの入れ直し・同じ CSS 変数）をしないこと（重くなる原因だった）。
//   node scripts/design-tests/resize-perf-test.js   （THEME=classic／EDITOR=v1 でも）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const th = process.env.THEME, ed = process.env.EDITOR || 'v2';
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=${ed}${th ? '&theme=' + th : ''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: 1480, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fbFabHintDone_v1', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);
  await p.evaluate(() => { if (window.editorV2Go) window.editorV2Go(4, true); });
  await p.evaluate(() => { for (let i = 0; i < 12; i++) { if (i) window.addRow(); const trs = [...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')]; const tr = trs[trs.length - 1]; const f = (n, x) => { const e = tr.querySelector(`[data-field="${n}"]`); if (!e) return; e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }; f('sv', 'SV' + (i % 3)); f('nm', '項目' + i); f('pq', '2'); f('pp', '1000'); f('mk', '100'); } });
  await p.waitForTimeout(1200);
  // 境目（1400／1440／1500px）をまたがない範囲で、少しずつ幅を変える
  await p.evaluate(() => { window.__mut = { hidden: [], style: 0, dock: 0 }; window.__mo = new MutationObserver(ms => ms.forEach(m => { if (m.type === 'attributes' && m.attributeName === 'hidden') window.__mut.hidden.push(m.target.id || m.target.className); if (m.type === 'attributes' && m.attributeName === 'style' && m.target === document.documentElement) window.__mut.style++; if (m.type === 'childList' && [...m.addedNodes].some(n => n.id === 'quoteActionDock')) window.__mut.dock++; })); window.__mo.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'style'] }); });
  for (let i = 0; i < 12; i++) { await p.setViewportSize({ width: 1478 - i * 2, height: 900 }); await p.waitForTimeout(40); }
  await p.waitForTimeout(500);
  const m = await p.evaluate(() => { window.__mo.disconnect(); return window.__mut; });
  ok('幅を少しずつ変えても hidden を書き換えない', m.hidden.length === 0, m.hidden.slice(0, 10));
  ok('幅を少しずつ変えても、上部のボタン（ドック）を入れ直さない', m.dock === 0, m.dock);
  ok('幅を少しずつ変えても、<html> の CSS 変数を書き換えない', m.style === 0, m.style);
  if (ed === 'v2') {
    // 境目をまたいだら、ステップのレールは今までどおり切り替わる（広い＝固定で開く／狭い＝しまう）
    await p.setViewportSize({ width: 1300, height: 900 }); await p.waitForTimeout(300);
    const narrow = await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('e2-rail-dock'));
    await p.setViewportSize({ width: 1600, height: 900 }); await p.waitForTimeout(300);
    const wide = await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('e2-rail-dock'));
    ok('境目をまたぐと、左のステップは切り替わる（狭い＝重ねる／広い＝固定で開く）', !narrow && wide, { narrow, wide });
    const inTb = await p.evaluate(() => document.getElementById('quoteActionDock').parentNode.id);
    ok('出力のボタンは上部のツールバーにある', inTb === 'saveToolbar', inTb);
  }
  ok('ページのエラーなし', errs.length === 0, errs);
  console.log('FAIL=' + fails); await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
