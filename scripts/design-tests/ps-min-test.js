// PROFIT SHARE の行：仕入に金額があれば代理店へ返す（売 0・利益 −仕入）、仕入が 0 で乗せ幅があれば代理店から受け取る（利益 ＋売）。架空データ・外部接続なし。
//   node scripts/design-tests/ps-min-test.js        （THEME=1 で Industry）
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
  const id = await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').id.replace('row-', ''));
  const set = (f, v) => p.evaluate(([i, v]) => { const el = document.getElementById(i); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [f + '-' + id, String(v)]);
  const snap = () => p.evaluate(id => new Promise(res => setTimeout(() => res({
    bp: document.getElementById('bp-' + id).value, st: document.querySelector('#st-' + id + ' .st-main')?.textContent.trim(),
    pr: document.querySelector('#pr-' + id + ' .pr-main')?.textContent.trim(), noProfit: document.getElementById('row-' + id).dataset.noProfit || '',
    psRow: !document.getElementById('totPsRow').hidden, psRev: document.getElementById('tot-ps-rev').textContent.trim(),
    psProfit: document.getElementById('tot-ps-profit').textContent.trim(), psLabel: document.getElementById('tot-ps-label').textContent.trim(), cost: document.getElementById('tot-cost').textContent.trim() }), 400)), id);
  await set('nm', 'PROFIT SHARE'); await set('un', 'C/W'); await set('pc', 'EUR'); await set('pq', '500'); await set('pp', '0.05');
  await p.evaluate(id => window.toggleMinMode(id), id); await set('ppmin', '40');
  let s = await snap();
  ok('PS でない行は従来どおり：売 25・仕入側だけ MIN なので利益は —', s.st === '25' && s.noProfit === '1', s);
  await p.evaluate(id => window.toggleProfitShare(id), id);
  s = await snap();
  ok('PS にすると売には数字を入れない（売単価 0・小計 —）', s.bp === '0' && s.st === '—', s);
  ok('PS の行の利益は −仕入（最低料金 40 を適用）＝ −40', s.pr === '-40' && !s.noProfit, s);
  ok('合計の「PS（代理店へ返す）」はマイナスの円換算', s.psRow && /^−¥[\d,]+$/.test(s.psRev) && s.psRev !== '−¥0' && s.psLabel === 'PS（代理店へ返す）', s);
  ok('PS の行は客先向けの仕入合計に入らない', s.cost === '0' || s.cost === '¥0', s);
  await set('pq', '1000');
  s = await snap();
  ok('数量を増やして最低料金を超えると −数量×単価（−50）', s.pr === '-50' && s.bp === '0', s);
  await set('bpmin', '30');
  s = await snap();
  ok('売の最低料金を入れても PS の売は 0 のまま', s.st === '—' && s.pr === '-50', s);
  await set('bpmin', ''); await set('pq', '500');
  await p.evaluate(id => window.toggleProfitShare(id), id);
  s = await snap();
  ok('PS を外すと売単価が仕入＋乗せ幅に戻る（0.05・売 25）', s.bp === '0.05' && s.st === '25' && !s.psRow, s);
  // 仕入が 0 で乗せ幅（売）に金額がある PS の行＝代理店から受け取る（プラス計上）
  await p.evaluate(id => window.toggleProfitShare(id), id);
  await set('ppmin', ''); await set('pp', '0'); await set('mk', '0.04');
  s = await snap();
  ok('仕入 0・乗せ幅 0.04 の PS の行は売 0.04・小計 20（代理店から受け取る）', s.bp === '0.04' && s.st === '20', s);
  ok('受け取る側の利益は ＋20（プラス）', s.pr === '20', s);
  ok('合計は「PS（代理店から受け取る）」に ＋¥…', s.psRow && /^＋¥[\d,]+$/.test(s.psRev) && s.psLabel === 'PS（代理店から受け取る）', s);
  await set('bpmin', '30');
  s = await snap();
  ok('受け取る側は売の最低料金（30）が効く', s.st === '30' && s.pr === '30', s);
  await set('bpmin', ''); await set('pp', '0.05');
  s = await snap();
  ok('仕入を入れると返す側に戻る（売 0・利益 −25）', s.bp === '0' && s.pr === '-25' && s.psLabel === 'PS（代理店へ返す）', s);
  await p.evaluate(id => window.toggleProfitShare(id), id);
  await set('mk', '0');
  s = await snap();
  ok('PS を外すと売単価が仕入＋乗せ幅に戻る', s.bp === '0.05' && s.st === '25' && !s.psRow, s);
  // 売値ベースの行：PS の間は売単価を控え、外すと戻す
  await p.evaluate(id => { window.toggleMinMode(id); }, id);
  const sm = await p.evaluate(id => { const b = document.querySelector('#row-' + id + ' .sell-mode-btn'); if (!b) return false; b.click(); return true; }, id);
  if (sm) {
    await set('bp', '0.08'); await p.waitForTimeout(200);
    await p.evaluate(id => window.toggleProfitShare(id), id);
    s = await snap();
    ok('売値ベースの行も PS の間は売 0', s.bp === '0' && s.pr === '-25', s);
    await p.evaluate(id => window.toggleProfitShare(id), id);
    s = await snap();
    const mk = await p.evaluate(id => document.getElementById('mk-' + id).value, id);
    ok('PS を外すと売値ベースの売単価（0.08）と乗せ幅（0.03）が戻る', s.bp === '0.08' && mk === '0.03', { s, mk });
  }
  ok('エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
