// 物量の「→見積」で、単位の表記ゆれ（R/T・RT・W/M・C/W・m³ など）を同じ単位として扱う。架空データ・外部接続なし。
//   node scripts/design-tests/unit-alias-reflect-test.js        （既定は Industry／CLASSIC=1 で現行）
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
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); p.setDefaultTimeout(10000);
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);

  // 1) 判定関数
  const kinds = await p.evaluate(() => ['RT', 'R/T', 'r/t', 'R.T', 'R T', 'Ｒ／Ｔ', ' rt ', 'W/M', 'WM', 'w/m', 'Revenue Ton', 'CW', 'C/W', 'c.w', 'Ｃ／Ｗ', 'Chargeable Weight', 'KG', 'KGS', 'kg', 'M3', 'm³', '㎥', 'CBM', 'CU.M', 'cbm', 'PCS', 'AWB/日/KGS', '20FT', '', 'JOB', 'R/T/日'].map(u => [u, window.quoteUnitKind(u)]));
  const exp = { 'RT': 'rt', 'R/T': 'rt', 'r/t': 'rt', 'R.T': 'rt', 'R T': 'rt', 'Ｒ／Ｔ': 'rt', ' rt ': 'rt', 'W/M': 'rt', 'WM': 'rt', 'w/m': 'rt', 'Revenue Ton': 'rt', 'CW': 'cw', 'C/W': 'cw', 'c.w': 'cw', 'Ｃ／Ｗ': 'cw', 'Chargeable Weight': 'cw', 'KG': 'kg', 'KGS': 'kg', 'kg': 'kg', 'M3': 'cbm', 'm³': 'cbm', '㎥': 'cbm', 'CBM': 'cbm', 'CU.M': 'cbm', 'cbm': 'cbm', 'PCS': 'pcs', 'AWB/日/KGS': null, '20FT': null, '': null, 'JOB': null, 'R/T/日': null };
  const bad = kinds.filter(([u, k]) => exp[u] !== k);
  ok('単位の表記ゆれを正しく分類（R/T・RT・W/M・C/W・m³・㎥・全角・空白・ピリオドなど。複合単位や無関係の単位は対象外）', bad.length === 0, bad);

  // 2) 「→見積」：表記の違う行すべてに反映される
  const units = ['R/T', 'RT', 'W/M', 'Ｒ／Ｔ', 'r.t', 'C/W', 'CW', 'KG', 'm³', 'CBM', '20FT', 'AWB/日/KGS', 'JOB'];
  const ids = await p.evaluate(us => {
    const first = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].length;
    for (let i = first; i < us.length; i++) window.addRow();
    const trs = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')];
    return trs.map((tr, i) => {
      const id = tr.id.replace('row-', '');
      const u = document.getElementById('un-' + id); u.value = us[i]; u.dispatchEvent(new Event('change', { bubbles: true }));
      const q = document.getElementById('pq-' + id); q.value = '1'; q.dispatchEvent(new Event('input', { bubbles: true }));
      return id;
    });
  }, units);
  await p.waitForTimeout(300);
  const pq = () => p.evaluate(ids => ids.map(i => document.getElementById('pq-' + i).value), ids);
  await p.evaluate(() => { _lastCargoMetrics = { rt: 2.5, cw: 300.5, cbm: 2.4, kg: 280, qty: 10 }; });
  await p.evaluate(() => window.reflectToQuote('rt')); await p.waitForTimeout(200);
  let v = await pq();
  ok('R/T の「→見積」：R/T・RT・W/M・全角・r.t の行すべてに 2.5 が入る', [0, 1, 2, 3, 4].every(i => v[i] === '2.5'), v);
  ok('R/T の「→見積」：C/W・KG・CBM・20FT・複合単位の行は変わらない', [5, 6, 7, 8, 9, 10, 11, 12].every(i => v[i] === '1'), v);
  await p.evaluate(() => window.reflectToQuote('cw')); await p.waitForTimeout(200);
  v = await pq();
  ok('CW の「→見積」：C/W・CW・KG の行に 300.5 が入る（従来どおり KG も対象）', [5, 6, 7].every(i => v[i] === '300.5'), v);
  ok('CW の「→見積」：m³・CBM・複合単位の行は変わらない', [8, 9, 10, 11, 12].every(i => v[i] === '1'), v);
  await p.evaluate(() => window.reflectToQuote('cbm')); await p.waitForTimeout(200);
  v = await pq();
  ok('CBM の「→見積」：m³・CBM の行に 2.4 が入る', v[8] === '2.4' && v[9] === '2.4', v);

  // 3) 計算ツール側の「反映」も同じ判定
  await p.evaluate(ids => ids.forEach(i => { const q = document.getElementById('pq-' + i); q.value = '1'; }), ids);
  await p.evaluate(() => { try { doReflect('rt', 3.25); } catch (e) { window.__e = String(e); } });
  await p.waitForTimeout(200); v = await pq();
  ok('計算ツールの「反映」（R/T）も、W/M・RT・全角の行に入る', [0, 1, 2, 3, 4].every(i => v[i] === '3.25') && v[5] === '1', { v, e: await p.evaluate(() => window.__e) });
  await p.evaluate(() => { try { doReflect('cw', 410); } catch (e) {} }); await p.waitForTimeout(200); v = await pq();
  ok('計算ツールの「反映」（CW）は C/W・CW の行（KG の行は kg 用なので対象外）', v[5] === '410' && v[6] === '410' && v[7] === '1', v);

  ok('JS エラーなし', errs.length === 0, errs);
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'FAIL あり' : 'ALL PASS');
  await b.close(); srv.close();
})();
