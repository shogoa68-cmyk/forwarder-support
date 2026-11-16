// 「○○の ○%」（他の行を基準にした % 行）：基準は参照行の小計（数量×売単価・MIN 適用後）を、通貨を換算して使う。
//   例：航空運賃 500 C/W × 1.95 EUR の 5%（COLLECTION FEE・1 JOB・最低 ¥3,000）→ 約 ¥8,644 が適用される。架空データ・外部接続なし。
//   node scripts/design-tests/pct-ref-test.js        （THEME=1 で Industry）
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
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
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

  const ids = await p.evaluate(() => { const trs = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')]; return trs.map(t => t.id.replace('row-', '')); });
  const A = ids[0];
  // 2 行目が無ければ追加
  let B = ids[1];
  if (!B) { await p.evaluate(() => window.addRow()); await p.waitForTimeout(300); B = await p.evaluate(() => { const t = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')]; return t[t.length - 1].id.replace('row-', ''); }); }
  const set = (f, id, v) => p.evaluate(([i, v]) => { const el = document.getElementById(i); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [f + '-' + id, String(v)]);
  const get = (f, id) => p.evaluate(i => document.getElementById(i)?.value, f + '-' + id);
  const stText = id => p.evaluate(i => document.querySelector('#st-' + i + ' .st-main')?.textContent.replace(/[^\d.]/g, ''), id);

  // 行 A：航空運賃 500 C/W × 1.95 EUR（売も EUR）
  await set('nm', A, '航空運賃'); await set('un', A, 'C/W');
  await p.evaluate(i => { const el = document.getElementById('pc-' + i); el.value = 'EUR'; el.dispatchEvent(new Event('change', { bubbles: true })); }, A);
  await set('pq', A, 500); await set('pp', A, 1.95); await set('mk', A, 0);
  // 行 B：COLLECTION FEE 1 JOB（円）・5%・最低 ¥3,000（仕入・売とも）
  await set('nm', B, 'COLLECTION FEE'); await set('un', B, 'JOB'); await set('pq', B, 1);
  await p.evaluate(i => { const btn = document.querySelector('#row-' + i + ' .pct-mode-btn'); btn && btn.click(); }, B);
  await p.waitForTimeout(200);
  await p.evaluate(([b, a]) => {
    const uidA = document.getElementById('uid-' + a).value;
    window._populatePprefSelect(b);
    const sel = document.getElementById('pprefsel-' + b); sel.value = uidA; sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, [B, A]);
  await set('pprate', B, 5);
  await set('ppmin', B, 3000); await set('bpmin', B, 3000);
  await p.waitForTimeout(300);

  const eurJpy = await p.evaluate(() => toJPY(1, 'EUR'));
  const expect = Math.round(975 * eurJpy * 0.05);
  const ppB = parseFloat(await get('pp', B)), bpB = parseFloat(await get('bp', B));
  ok('参照行は 975 EUR（小計）', Math.abs(parseFloat(await stText(A)) - 975) < 0.01, await stText(A));
  ok('％の行の仕入単価は「航空運賃の金額（円換算）の 5%」＝約 ' + expect, ppB === expect && expect > 3000, { ppB, expect });
  ok('売単価も同じ（乗せ幅 0）', bpB === expect, bpB);
  ok('小計は ' + expect + '（最低 ¥3,000 ではなく従量が適用される）', parseFloat((await stText(B)).replace(/[^\d]/g, '')) === expect, await stText(B));
  ok('基準額の欄は参照行の金額（円換算）', Math.abs(parseFloat(await get('ppbase', B)) - Math.round(975 * eurJpy * 100) / 100) < 0.01, await get('ppbase', B));
  ok('適用の判定は従量（最低料金の方が小さい）', await p.evaluate(([q, price, min]) => window.minAppliedKind(q, price, min), [1, ppB, 3000]) === 'rate', ppB);

  // 参照行の数量を変えると追従
  await set('pq', A, 100);
  await p.waitForTimeout(200);
  const expect2 = Math.round(195 * eurJpy * 0.05);
  ok('参照行の数量を変えると追従（100 C/W → 195 EUR の 5%）＝' + expect2 + '（最低 ¥3,000 が適用される）', parseFloat(await get('pp', B)) === expect2, await get('pp', B));
  ok('金額が最低 ¥3,000 を下回るので小計は 3,000', parseFloat((await stText(B)).replace(/[^\d]/g, '')) === 3000, await stText(B));
  await set('pq', A, 500);

  // 参照行に売のミニマムがあれば、その適用後の金額が基準（最低 1,500 EUR）
  await set('bpmin', A, 1500);
  await p.waitForTimeout(200);
  const expect3 = Math.round(1500 * eurJpy * 0.05);
  ok('参照行のミニマム適用後の金額（1,500 EUR）が基準', parseFloat(await get('pp', B)) === expect3, { pp: await get('pp', B), expect3 });
  await set('bpmin', A, '');

  // 為替レートを変えると換算し直す
  await p.evaluate(() => window.updateFxRate('EUR', 200));
  await p.waitForTimeout(200);
  ok('為替レートを変えると仕入単価も換算し直す（200 円/EUR → 9,750）', parseFloat(await get('pp', B)) === 9750, await get('pp', B));
  await p.evaluate(v => window.updateFxRate('EUR', v), eurJpy);

  // 同じ通貨（参照行も % 行も EUR）：975 EUR の 5% ＝ 48.75
  await p.evaluate(i => { const el = document.getElementById('pc-' + i); el.value = 'EUR'; el.dispatchEvent(new Event('change', { bubbles: true })); }, B);
  await p.waitForTimeout(200);
  ok('同じ通貨なら換算なし（EUR の 5% ＝ 48.75）', Math.abs(parseFloat(await get('pp', B)) - 48.75) < 0.001, await get('pp', B));

  // 数量が同じ行（参照 500 C/W・% 行も 500）は従来どおり「参照行の売単価の 5%」（1.95 EUR → 0.10）
  await set('pq', B, 500);
  await p.waitForTimeout(200);
  ok('数量が同じなら 1 単位あたり（売単価 1.95 EUR の 5% ＝ 0.10）', Math.abs(parseFloat(await get('pp', B)) - 0.1) < 0.001, await get('pp', B));

  // 保存 → 読込（復元）しても、仕入単価・基準額が崩れない
  await set('pq', B, 1); await p.evaluate(i => { const el = document.getElementById('pc-' + i); el.value = 'JPY'; el.dispatchEvent(new Event('change', { bubbles: true })); }, B);
  await p.waitForTimeout(200);
  const before = await p.evaluate(i => ({ pp: document.getElementById('pp-' + i).value, bp: document.getElementById('bp-' + i).value }), B);
  await p.evaluate(() => { const d = JSON.parse(JSON.stringify(gatherAllData())); _applyQuoteData(d); });
  await p.waitForTimeout(800);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(tr => { const i = tr.id.replace('row-', ''); return { nm: document.getElementById('nm-' + i).value, pp: document.getElementById('pp-' + i).value, bp: document.getElementById('bp-' + i).value, pct: tr.classList.contains('row-pct-mode'), ref: !!document.getElementById('ppref-' + i).value }; }));
  const rb = rows.find(r => r.nm === 'COLLECTION FEE');
  ok('復元しても % の行の仕入単価・売単価が変わらない', rb && rb.pp === before.pp && rb.bp === before.bp && rb.pct && rb.ref, { before, rb });

  ok('JS エラーなし', errs.length === 0, errs);
  console.log(out.join('\n'));
  console.log(out.some(l => l.startsWith('FAIL')) ? '\n失敗あり' : '\n全項目 PASS');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
