// 行の操作（👁 🔍 ✓ ➕ 📋 🗑）を押したら、吹き出しがすぐ閉じる確認
//   node scripts/design-tests/row-acts-dismiss-test.js   （THEME=classic で現行・EDITOR=v2 で新画面）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const v2 = process.env.EDITOR === 'v2', th = process.env.THEME;
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=${v2 ? 'v2' : 'v1'}${th ? '&theme=' + th : ''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('quoteRemarkSheetSeen_v1', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { try { window.qpNewQuote(); } catch (e) {} }); await p.waitForTimeout(1200);
  if (v2) { await p.evaluate(() => { const b = document.querySelector('[data-e2s="4"]'); b && b.click(); }); await p.waitForTimeout(500); }
  await p.evaluate(() => { window.addRow && window.addRow(); }); await p.waitForTimeout(500);
  if (v2) {   // Design 50（案A）：新しい画面は吹き出しではなく［⋯］のメニュー（row-acts-hint-test.js で確認）
    console.log('SKIP 新しい画面は［⋯］のメニューに置き換えた（Design 50）');
    await b.close(); srv.close(); process.exit(0);
  }
  const rowSel = '#quoteTable tbody tr:not([data-virtual="1"])';
  const actsVisible = () => p.evaluate(sel => { const tr = document.querySelector(sel); const a = tr && tr.querySelector('.row-acts'); if (!a) return null; const r = a.getBoundingClientRect(), c = getComputedStyle(a); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.5; }, rowSel);
  const hoverCell = async () => { const h = await p.$(rowSel + ' td.handle-cell .row-acts-hint'); await h.hover(); await p.waitForTimeout(250); };
  await hoverCell();
  ok('ハンドル欄にカーソルを乗せると操作の吹き出しが出る', await actsVisible() === true);
  for (const [cls, name] of [['row-done-btn', '入力完了'], ['row-pending-btn', '要調査'], ['row-hidequote-btn', '見積書に出さない']]) {
    await hoverCell();
    await p.click(rowSel + ' .row-acts .' + cls); await p.waitForTimeout(80);
    ok(name + 'を押すと、カーソルが乗ったままでも吹き出しがすぐ閉じる', (await actsVisible()) === false);
    await p.mouse.move(700, 15); await p.waitForTimeout(300);
    await hoverCell();
    ok(name + 'のあと、カーソルを離して乗せ直すと、また出る', await actsVisible() === true);
    await p.click(rowSel + ' .row-acts .' + cls); await p.waitForTimeout(80);   // 元に戻す（トグル）
    await p.mouse.move(700, 15); await p.waitForTimeout(300);
  }
  // 直下に追加：押すと閉じ、行が増える
  const n0 = (await p.$$(rowSel)).length;
  await hoverCell(); await p.click(rowSel + ' .row-acts .row-add-btn'); await p.waitForTimeout(150);
  ok('直下に追加を押すと、吹き出しが閉じて行が増える', (await actsVisible()) === false && (await p.$$(rowSel)).length === n0 + 1);
  ok('エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
