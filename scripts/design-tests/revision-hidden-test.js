// 「前回提示分からの変更点」は見積書に出さない行（PROFIT SHARE・👁 非表示）を拾わない。架空データ・外部接続なし。
//   node scripts/design-tests/revision-hidden-test.js        （THEME=1 で Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
  const ids = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(t => t.id.replace('row-', '')));
  await p.evaluate(() => { window.addRow(); window.addRow(); }); await p.waitForTimeout(300);
  const [A, B, C] = await ids();
  const set = (id, f, v) => p.evaluate(([i, v]) => { const el = document.getElementById(i); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [f + '-' + id, String(v)]);
  await set(A, 'nm', 'PICK UP'); await set(A, 'pq', '1'); await set(A, 'pp', '350');
  await set(B, 'nm', 'PROFIT SHARE'); await set(B, 'pq', '1'); await set(B, 'mk', '0');
  await set(C, 'nm', 'THC'); await set(C, 'pq', '1'); await set(C, 'pp', '1000');
  await p.evaluate(id => window.toggleProfitShare(id), B); await p.waitForTimeout(300);
  const baseline = async (strip) => p.evaluate(strip => { const s = window.buildRevisionSnapshot(); if (strip) { s.rows.forEach(r => delete r.h); delete s.hv; } document.getElementById('qf-revision-baseline').value = JSON.stringify(s); return s; }, strip);
  const diff = () => p.evaluate(() => { const d = window.computeRevisionDiff(); return d && { added: d.added.map(r => r.nm), removed: d.removed.map(r => r.nm), changed: d.changed.map(c => c.name) }; });
  const s0 = await baseline(false);
  ok('スナップショットで PS の行に h:1 が付く', s0.rows.find(r => r.nm === 'PROFIT SHARE')?.h === 1 && !s0.rows.find(r => r.nm === 'PICK UP')?.h, s0.rows);
  await set(A, 'pp', '385'); await set(B, 'mk', '30'); await p.waitForTimeout(300);
  let d = await diff();
  ok('PS の行の変更は出さず、PICK UP の変更だけ出す', d && d.changed.length === 1 && d.changed[0] === 'PICK UP' && !d.added.length && !d.removed.length, d);
  // h を持たない古いスナップショットでも PS の行は拾わない（画像の状況）
  await set(A, 'pp', '350'); await set(B, 'mk', '0'); await p.waitForTimeout(200);
  await baseline(true);
  await set(A, 'pp', '385'); await set(B, 'mk', '50'); await p.waitForTimeout(300);
  d = await diff();
  ok('古いスナップショットでも PS の行は拾わない', d && d.changed.join() === 'PICK UP' && !d.added.length && !d.removed.length, d);
  // 前回は出していて、今回 👁 で見積書から外した行は「削除」
  await baseline(false);
  await p.evaluate(id => document.querySelector('#row-' + id + ' .row-hidequote-btn').click(), C); await p.waitForTimeout(300);
  d = await diff();
  ok('今回から見積書に出さない行は「削除」として出る', d && d.removed.join() === 'THC' && !d.changed.length, d);
  await p.evaluate(id => document.querySelector('#row-' + id + ' .row-hidequote-btn').click(), C); await p.waitForTimeout(300);
  d = await diff();
  ok('戻すと差分なし', d === null, d);
  // PDF の変更点ブロックにも PS が出ない
  await set(B, 'mk', '100'); await p.waitForTimeout(300);
  const html = await p.evaluate(() => { const d = window.computeRevisionDiff(); return JSON.stringify(d); });
  ok('PS だけ変えたときは差分なし', html === 'null', html);
  ok('エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
