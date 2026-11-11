// 行と計算の回帰試験（PS行のミニマム・除外グループの小計・行の移動とリマーク・複製の参考/概算）。架空データ・外部接続なし。
//   node scripts/design-tests/row-calc-test.js
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
  const out = [];
  const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));

  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);

  const ids = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(t => t.id.replace('row-', '')));
  const setRow = (id, o) => p.evaluate(([id, o]) => {
    Object.entries(o).forEach(([k, v]) => { const e = document.getElementById(k + '-' + id); if (e) e.value = v; });
    onPay(parseInt(id));
  }, [id, o]);
  const seqOf = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr:not([data-virtual])')].map(t => t.dataset.type === 'remark' ? 'R:' + t.dataset.parentId : 'row-' + t.id.replace('row-', '')));

  // ---- 1. PROFIT SHARE 行にもミニマムが効く（社内利益の売上）----
  const [a] = await ids();
  await setRow(a, { nm: 'PS fee', pq: '1', pp: '100', mk: '0', ppmin: '500', bpmin: '800' });
  await p.evaluate(id => { document.getElementById('ps-' + id).value = '1'; calc(parseInt(id)); updateTotals(); }, a);
  await p.waitForTimeout(100);
  const ps = await p.evaluate(() => document.getElementById('tot-ps-rev')?.textContent || '');
  ok('PS行の売上にミニマム(800)が効く', /800/.test(ps), ps);

  // ---- 2. 除外グループの行は手動小計に入らない ----
  await p.evaluate(id => { document.getElementById('ps-' + id).value = ''; }, a);
  await setRow(a, { nm: 'A', pq: '1', pp: '100', mk: '0', ppmin: '', bpmin: '' });
  await p.evaluate(() => addRow());
  let all = await ids(); const b2 = all[all.length - 1];
  await setRow(b2, { nm: 'B', pq: '1', pp: '300', mk: '0' });
  await p.evaluate(() => insertSubtotalRow());
  await p.evaluate(id => { document.getElementById('row-' + id).dataset.excluded = '1'; updateSubtotalRows(); }, b2);
  const sub = await p.evaluate(() => document.querySelector('tr[data-type="subtotal"] .subtotal-group-subtotal')?.textContent.trim());
  ok('除外行は小計に入らない(100)', /^100$/.test(sub || ''), sub);
  await p.evaluate(id => { delete document.getElementById('row-' + id).dataset.excluded; }, b2);

  // ---- 3. 行を動かしても、リマークが親から離れない ----
  await p.evaluate(() => { document.querySelectorAll('tr[data-type="subtotal"]').forEach(t => t.remove()); });
  await p.evaluate(id => insertRemarkRow(id, { text: 'note-B', noFocus: true }), b2);
  await p.evaluate(() => addRow());
  all = await ids(); const c3 = all[all.length - 1];
  await setRow(c3, { nm: 'C', pq: '1', pp: '10' });
  await p.evaluate(id => moveRow(document.getElementById('row-' + id), 1), a);   // A を下へ（B とそのリマークを飛び越える）
  const seq = await seqOf();
  const iB = seq.indexOf('row-' + b2), iA = seq.indexOf('row-' + a);
  ok('下へ移動：Bの直後にBのリマーク・Aはその後ろ', seq[iB + 1] === 'R:' + b2 && iA > iB + 1, seq);
  await p.evaluate(id => moveRow(document.getElementById('row-' + id), -1), c3);   // C を上へ（B ごと飛び越える）
  const seq2 = await seqOf();
  const jB = seq2.indexOf('row-' + b2);
  ok('上へ移動：リマークはBの直後のまま', seq2[jB + 1] === 'R:' + b2, seq2);

  // ---- 4. 複製で 参考情報(ri)・概算(es) が引き継がれる ----
  await p.evaluate(id => { document.getElementById('ri-' + id).value = '1'; document.getElementById('es-' + id).value = '1'; calc(parseInt(id)); }, c3);
  const nid = await p.evaluate(id => duplicateRow(id), c3);
  const dup = await p.evaluate(n => [document.getElementById('ri-' + n).value, document.getElementById('es-' + n).value], nid);
  ok('複製で参考・概算フラグが残る', dup[0] === '1' && dup[1] === '1', dup);

  ok('ページエラーなし', errs.length === 0, errs);
  console.log(out.join('\n'));
  console.log(out.every(l => l.startsWith('PASS')) ? 'OK' : 'NG');
  await b.close(); srv.close();
  process.exit(out.every(l => l.startsWith('PASS')) ? 0 : 1);
})();
