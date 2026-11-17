// 物量パターンが 2 つ以上あるとき、数量を変えて保存 → 開き直しても数量が元に戻らない。架空データ・外部接続なし。
//   node scripts/design-tests/qty-pattern-save-test.js        （既定は Industry／CLASSIC=1 で現行）
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
  await ctx.addInitScript(cl => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify(cl ? { site: false, doc: false } : { site: true, doc: true })); } catch (e) {} }, !!process.env.CLASSIC);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss()); p.setDefaultTimeout(10000);
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(t => t.id.replace('row-', '')));
  const pq = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(t => document.getElementById('pq-' + t.id.replace('row-', '')).value));
  // 明細 2 行（単位 20FT と 40HQ）を作り、物量パターンを 2 つにする
  await p.evaluate(() => { window.addRow(); });
  let ids = await rows();
  await p.evaluate(ids => { const s = (f, i, v) => { const el = document.getElementById(f + '-' + i); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    s('nm', ids[0], '海上運賃A'); s('un', ids[0], '20FT'); s('pq', ids[0], '1'); s('pp', ids[0], '100');
    s('nm', ids[1], '海上運賃B'); s('un', ids[1], '40HQ'); s('pq', ids[1], '1'); s('pp', ids[1], '200'); }, ids);
  await p.evaluate(() => { window.prompt = () => 'パターン2'; window.addPackingPattern(); }); await p.waitForTimeout(400);
  await p.evaluate(() => { switchPackingPattern(0); }); await p.waitForTimeout(300);
  ok('物量パターンが 2 つ以上ある', (await p.evaluate(() => _packingPatterns.length)) >= 2);

  // 1) 「単位で数量を一括変更」で 20FT の数量を 3 に → 保存 → 開き直し
  await p.evaluate(() => { udRefresh && udRefresh(); }); await p.waitForTimeout(200);
  const res = await p.evaluate(() => {
    const panel = document.getElementById('scPanel'); if (!panel) return { noPanel: true };
    const row = [...panel.querySelectorAll('.ud-row')].find(r => /20FT/.test(r.textContent));
    if (!row) return { noRow: panel.innerHTML.slice(0, 300) };
    const inp = row.querySelector('.ud-qty-in'); inp.value = '3'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    const _c = window.confirm; window.confirm = () => false;
    udApplyAll(); window.confirm = _c; return { ok: true };
  });
  ok('一括変更が実行できた', res.ok === true, res);
  ids = await rows();
  ok('一括変更で 20FT の行の数量が 3 になる', (await pq())[0] === '3', await pq());
  const snap = await p.evaluate(() => JSON.parse(JSON.stringify(gatherAllData())));
  await p.evaluate(d => { _applyQuoteData(d); }, snap); await p.waitForTimeout(900);
  const afterOpen = await pq();
  ok('保存 → 開き直しても 20FT の数量は 3 のまま（元の 1 に戻らない）', afterOpen[0] === '3', afterOpen);
  ok('保存 → 開き直しても 40HQ の数量は 1 のまま', afterOpen[1] === '1', afterOpen);

  // 2) 数量欄を直接編集した場合も同じ
  ids = await rows();
  await p.evaluate(ids => { const el = document.getElementById('pq-' + ids[1]); el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })); }, ids);
  if (process.env.DBG) console.log('DBG', await p.evaluate(() => ({ mem: JSON.stringify(_packingPatterns.map(x => x.qtyLinks)), hid: JSON.parse(document.getElementById('cond-packing-patterns').value).patterns.map(x => x.qtyLinks) })));
  const snap2 = await p.evaluate(() => JSON.parse(JSON.stringify(gatherAllData())));
  await p.evaluate(d => { _applyQuoteData(d); }, snap2); await p.waitForTimeout(900);
  const a2 = await pq();
  ok('数量欄を直接 5 に変えて保存 → 開き直しても 5 のまま', a2[1] === '5' && a2[0] === '3', a2);

  // 3) パターンを切り替えて戻しても、それぞれの数量が保たれる
  await p.evaluate(() => { switchPackingPattern(1); }); await p.waitForTimeout(300);
  ids = await rows();
  await p.evaluate(ids => { const el = document.getElementById('pq-' + ids[0]); el.value = '7'; el.dispatchEvent(new Event('input', { bubbles: true })); }, ids);
  const snap3 = await p.evaluate(() => JSON.parse(JSON.stringify(gatherAllData())));
  await p.evaluate(d => { _applyQuoteData(d); }, snap3); await p.waitForTimeout(900);
  const a3 = await pq();
  ok('パターン 2 で 7 に変えて保存 → 開き直しても（パターン 2 のまま）7', a3[0] === '7', a3);
  await p.evaluate(() => { switchPackingPattern(0); }); await p.waitForTimeout(300);
  const a4 = await pq();
  ok('パターン 1 に切り替えると、パターン 1 の数量（3）に戻る', a4[0] === '3', a4);

  ok('JS エラーなし', errs.length === 0, errs);
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'FAIL あり' : 'ALL PASS');
  await b.close(); srv.close();
})();
