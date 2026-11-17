// 保険カテゴリの行の「保険料の計算」：貨物価額 × 保険価額率(110%) × 保険料率 → 仕入単価。架空データ・外部接続なし。
//   node scripts/design-tests/insurance-row-test.js        （既定は Industry／CLASSIC=1 で現行）
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
  await ctx.addInitScript(cl => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify(cl ? { site: false, doc: false } : { site: true, doc: true })); } catch (e) {} }, !!process.env.CLASSIC);   // 既定は Industry／CLASSIC=1 で現行
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); p.setDefaultTimeout(10000);
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
  const rowIds = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(t => t.id.replace('row-', '')));
  const A = (await rowIds())[0];
  const set = (f, id, v) => p.evaluate(([i, v]) => { const el = document.getElementById(i); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [f + '-' + id, String(v)]);
  const get = (f, id) => p.evaluate(i => document.getElementById(i)?.value, f + '-' + id);
  const ui = (id, sel, v) => p.evaluate(([id, sel, v]) => { const el = document.querySelector('#row-' + id + ' ' + sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, sel, String(v)]);
  const insVis = id => p.evaluate(i => { const g = document.querySelector('#row-' + i + ' .ins-group'); return !!g && g.getClientRects().length > 0 && getComputedStyle(g).display !== 'none'; }, id);
  const hint = id => p.evaluate(i => document.querySelector('#row-' + i + ' .ins-hint')?.textContent || '', id);
  const pp = id => p.evaluate(i => parseFloat(document.getElementById('pp-' + i).value), id);

  // 1) 保険料カテゴリを選ぶと、仕入単価が未入力のとき保険料の計算が ON になる（保険料カテゴリ以外では ON にならない）
  await set('nm', A, '海上保険料'); await set('pq', A, 1); await set('un', A, 'JOB');
  await p.evaluate(i => { const el = document.getElementById('cat-' + i); el.value = 'freight'; el.dispatchEvent(new Event('change', { bubbles: true })); }, A);
  await p.waitForTimeout(150);
  ok('他のカテゴリでは保険料の計算は ON にならない', !(await p.evaluate(i => document.getElementById('row-' + i).classList.contains('row-ins-mode'), A)));
  await p.evaluate(i => { const el = document.getElementById('cat-' + i); el.value = 'insurance'; el.dispatchEvent(new Event('change', { bubbles: true })); }, A);
  await p.waitForTimeout(300);
  ok('「保険料」カテゴリを選ぶと保険料の計算が ON（入力欄が出る）', await p.evaluate(i => document.getElementById('row-' + i).classList.contains('row-ins-mode'), A) && await insVis(A));
  ok('保険価額率の初期値は 110%', (await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-k').value, A)) === '110');
  ok('貨物価額の通貨の初期値は仕入通貨（JPY）', (await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-c').value, A)) === 'JPY');
  ok('入力が足りないあいだは説明だけ・仕入単価は 0 のまま', /貨物価額と保険料率を入れると/.test(await hint(A)) && (await pp(A)) === 0);

  // 2) 円：1,000,000 × 110% × 0.3% = 3,300
  await ui(A, '.ins-v', 1000000); await ui(A, '.ins-r', 0.3); await p.waitForTimeout(200);
  ok('貨物価額 1,000,000 円 × 110% × 0.3% ＝ 仕入単価 3,300', (await pp(A)) === 3300, await pp(A));
  ok('仕入単価は読み取り専用（計算結果）', await p.evaluate(i => document.getElementById('pp-' + i).readOnly, A));
  ok('説明に保険価額・保険料が出る', /保険価額 JPY 1,100,000/.test(await hint(A)) && /保険料 JPY 3,300/.test(await hint(A)), await hint(A));
  // 端数は切り上げ：1,234,567 × 1.1 × 0.25% = 3,395.06 → 3,396
  await ui(A, '.ins-v', 1234567); await ui(A, '.ins-r', 0.25); await p.waitForTimeout(150);
  ok('端数は 1 円単位で切り上げ（3,395.06 → 3,396）', (await pp(A)) === 3396, await pp(A));
  // 保険価額率を変える：100%
  await ui(A, '.ins-k', 100); await p.waitForTimeout(150);
  ok('保険価額率を 100% にすると 1,234,567 × 0.25% ＝ 3,087 に（3,086.4 → 3,087）', (await pp(A)) === 3087, await pp(A));
  await ui(A, '.ins-k', 110); await p.waitForTimeout(100);

  // 3) 売値は乗せ幅で上乗せ・最低保険料（仕入 MIN）
  await set('mk', A, 500); await p.waitForTimeout(150);
  ok('売単価＝仕入単価＋乗せ幅（3,396＋500）', (await p.evaluate(i => parseFloat(document.getElementById('bp-' + i).value), A)) === 3896);
  await set('ppmin', A, 5000); await p.waitForTimeout(150);
  const prof = await p.evaluate(i => (document.querySelector('#pr-' + i + ' .pr-main') || document.getElementById('pr-' + i))?.textContent || '', A);
  ok('最低保険料（仕入 MIN）を設定しても、保険料の計算は崩れない（仕入単価はそのまま）', (await pp(A)) === 3396);
  await set('ppmin', A, ''); await p.waitForTimeout(100);

  // 4) 外貨：貨物価額 USD 10,000 → 保険料 USD 33 を円へ換算
  const usdJpy = await p.evaluate(() => toJPY(1, 'USD'));
  await ui(A, '.ins-c', 'USD'); await ui(A, '.ins-v', 10000); await ui(A, '.ins-r', 0.3); await ui(A, '.ins-k', 110); await p.waitForTimeout(250);
  const expect = Math.ceil(33 * usdJpy - 1e-9);
  ok('貨物価額が USD で仕入通貨が JPY のとき、換算して切り上げ（USD 33 → 円）', (await pp(A)) === expect, { got: await pp(A), expect, usdJpy });
  ok('説明に換算後の円が出る', /≈ JPY/.test(await hint(A)) && /保険料 USD 33/.test(await hint(A)), await hint(A));
  // 為替レートを変えると追従（updateFxRate → recalcPctRows → 保険料の行も計算し直す）
  const rate0 = usdJpy;
  await p.evaluate(r => window.updateFxRate('USD', r), rate0 + 10); await p.waitForTimeout(250);
  const expect2 = Math.ceil(33 * (rate0 + 10) - 1e-9);
  ok('為替レートを変えると、外貨の貨物価額の保険料（円）も計算し直される', (await pp(A)) === expect2, { got: await pp(A), expect2 });
  await p.evaluate(r => window.updateFxRate('USD', r), rate0); await p.waitForTimeout(150);
  await ui(A, '.ins-c', 'JPY'); await ui(A, '.ins-v', 1000000); await ui(A, '.ins-r', 0.3); await p.waitForTimeout(150);

  // 5) 保存 → 復元
  await p.evaluate(() => { const d = JSON.parse(JSON.stringify(gatherAllData())); _applyQuoteData(d); }); await p.waitForTimeout(900);
  const A2 = (await rowIds())[0];
  ok('保存→復元しても保険料の計算が ON・入力値と仕入単価が残る', await p.evaluate(i => document.getElementById('row-' + i).classList.contains('row-ins-mode'), A2) && (await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-v').value, A2)) === '1000000' && (await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-r').value, A2)) === '0.3' && (await pp(A2)) === 3300, { pp: await pp(A2) });
  await p.evaluate(i => { const tr = document.getElementById('row-' + i); if (window.rowDetailToggle && !tr.querySelector('.ins-group')?.offsetParent) window.rowDetailToggle(tr, true); }, A2); await p.waitForTimeout(150);   // Industry は復元直後は「その他 ▾」が閉じている
  ok('復元後も入力欄が見える・説明が出る', await insVis(A2) && /保険料 JPY 3,300/.test(await hint(A2)), await hint(A2));
  ok('復元後も仕入単価は読み取り専用', await p.evaluate(i => document.getElementById('pp-' + i).readOnly, A2));

  // 6) 複製
  await p.evaluate(i => window.duplicateRow(i), A2); await p.waitForTimeout(500);
  const ids2 = await rowIds(); const C = ids2[1];
  ok('行を複製しても保険料の計算が引き継がれる', await p.evaluate(i => document.getElementById('row-' + i).classList.contains('row-ins-mode'), C) && (await pp(C)) === 3300 && (await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-v').value, C)) === '1000000', { c: C, pp: await pp(C) });
  await ui(C, '.ins-v', 2000000); await p.waitForTimeout(150);
  ok('複製した行を変えても、元の行の保険料は変わらない', (await pp(C)) === 6600 && (await pp(A2)) === 3300, { c: await pp(C), a: await pp(A2) });

  // 7) 他のモードとの排他（%・売値ベース）
  await p.evaluate(i => document.querySelector('#row-' + i + ' .pct-mode-btn').click(), A2); await p.waitForTimeout(150);
  ok('保険料の計算が ON の行では「%」を ON にできない', !(await p.evaluate(i => document.getElementById('row-' + i).classList.contains('row-pct-mode'), A2)));
  await p.evaluate(i => document.querySelector('#row-' + i + ' .sell-mode-btn').click(), A2); await p.waitForTimeout(150);
  ok('保険料の計算が ON の行では「売値ベース」も ON にできない', (await get('ppmode', A2)) !== 'sell');

  // 8) 解除：仕入単価は残り、編集できる
  await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-mode-btn').click(), A2); await p.waitForTimeout(200);
  ok('解除すると入力欄が消え、仕入単価（3,300）は残って編集できる', !(await insVis(A2)) && (await pp(A2)) === 3300 && !(await p.evaluate(i => document.getElementById('pp-' + i).readOnly, A2)) && (await get('ins', A2)) === '');
  // 手入力した仕入単価がある行では、カテゴリを保険料にしても自動では ON にしない
  const D = await p.evaluate(() => { window.addRow(); const t = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')]; return t[t.length - 1].id.replace('row-', ''); });
  await set('pp', D, 1234); await p.evaluate(i => { const el = document.getElementById('cat-' + i); el.value = 'insurance'; el.dispatchEvent(new Event('change', { bubbles: true })); }, D); await p.waitForTimeout(200);
  ok('仕入単価を入力済みの行は、カテゴリを保険料にしても自動では ON にならない（金額を上書きしない）', !(await p.evaluate(i => document.getElementById('row-' + i).classList.contains('row-ins-mode'), D)) && (await pp(D)) === 1234);
  // 手で ON にできる
  await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-mode-btn').click(), D); await p.waitForTimeout(150);
  ok('「🛡️ 保険料」ボタンで手動でも ON にできる（入力が足りないうちは仕入単価 1,234 を上書きしない）', await insVis(D) && (await pp(D)) === 1234);
  ok('JS エラーなし', errs.length === 0, errs);
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'FAIL あり' : 'ALL PASS');
  await b.close(); srv.close();
})();
