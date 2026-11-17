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
  let A = (await rowIds())[0];
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

  // 1b) マージン方式（既定 10%）：実際の保険料＝売、保険料の 10%＝乗せ幅、仕入＝保険料−マージン
  const mk0 = id => p.evaluate(i => parseFloat(document.getElementById('mk-' + i).value), id);
  const bp0 = id => p.evaluate(i => parseFloat(document.getElementById('bp-' + i).value), id);
  ok('マージン率の初期値は 10%', (await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-m').value, A)) === '10');
  await ui(A, '.ins-v', 1000000); await ui(A, '.ins-r', 0.3); await p.waitForTimeout(200);
  ok('実際の保険料 3,300 ＝ 売単価', (await bp0(A)) === 3300, await bp0(A));
  ok('マージン＝保険料の 10%（330）＝乗せ幅', (await mk0(A)) === 330, await mk0(A));
  ok('仕入単価＝保険料−マージン（2,970）', (await pp(A)) === 2970, await pp(A));
  ok('マージン方式のあいだ、乗せ幅も読み取り専用', await p.evaluate(i => document.getElementById('mk-' + i).readOnly, A));
  ok('説明に「売／マージン／仕入」が出る', /売 JPY 3,300／マージン 10% JPY 330／仕入 JPY 2,970/.test(await hint(A)), await hint(A));
  await ui(A, '.ins-m', 15); await p.waitForTimeout(150);
  ok('マージン 15% → 乗せ幅 495・仕入 2,805・売は 3,300 のまま', (await mk0(A)) === 495 && (await pp(A)) === 2805 && (await bp0(A)) === 3300, { mk: await mk0(A), pp: await pp(A), bp: await bp0(A) });
  // 端数：1,234,567 × 1.1 × 0.25% = 3,396（切り上げ）→ マージン 10% = 339.6 → 340・仕入 3,056
  await ui(A, '.ins-v', 1234567); await ui(A, '.ins-r', 0.25); await ui(A, '.ins-m', 10); await p.waitForTimeout(150);
  ok('端数：保険料 3,396 → マージン 340（四捨五入）・仕入 3,056・売 3,396', (await mk0(A)) === 340 && (await pp(A)) === 3056 && (await bp0(A)) === 3396, { mk: await mk0(A), pp: await pp(A), bp: await bp0(A) });
  // 保存→復元
  await p.evaluate(() => { const d = JSON.parse(JSON.stringify(gatherAllData())); _applyQuoteData(d); }); await p.waitForTimeout(800);
  const AM = (await rowIds())[0];
  ok('マージン方式も保存→復元で残る（率・乗せ幅・仕入・売）', (await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-m').value, AM)) === '10' && (await mk0(AM)) === 340 && (await pp(AM)) === 3056 && (await bp0(AM)) === 3396 && await p.evaluate(i => document.getElementById('mk-' + i).readOnly, AM));
  // マージン率を空にすると従来方式（仕入＝保険料・乗せ幅は手入力に戻る）
  await ui(AM, '.ins-m', ''); await p.waitForTimeout(150);
  ok('マージン率を空にすると従来方式（仕入＝保険料 3,396・乗せ幅は編集できる）', (await pp(AM)) === 3396 && !(await p.evaluate(i => document.getElementById('mk-' + i).readOnly, AM)), { pp: await pp(AM) });
  A = AM;   // 復元で行の番号が変わるため、以降の（従来方式の）確認はこの行で続ける
  await set('mk', AM, 0); await ui(AM, '.ins-v', 1000000); await ui(AM, '.ins-r', 0.3); await p.waitForTimeout(150);

  // 2) 円：1,000,000 × 110% × 0.3% = 3,300
  await ui(AM, '.ins-v', 1000000); await ui(AM, '.ins-r', 0.3); await p.waitForTimeout(200);
  ok('貨物価額 1,000,000 円 × 110% × 0.3% ＝ 仕入単価 3,300', (await pp(AM)) === 3300, await pp(AM));
  ok('仕入単価は読み取り専用（計算結果）', await p.evaluate(i => document.getElementById('pp-' + i).readOnly, AM));
  ok('説明に保険価額・保険料が出る', /保険価額 JPY 1,100,000/.test(await hint(AM)) && /保険料 JPY 3,300/.test(await hint(AM)), await hint(AM));
  // 端数は切り上げ：1,234,567 × 1.1 × 0.25% = 3,395.06 → 3,396
  await ui(AM, '.ins-v', 1234567); await ui(AM, '.ins-r', 0.25); await p.waitForTimeout(150);
  ok('端数は 1 円単位で切り上げ（3,395.06 → 3,396）', (await pp(AM)) === 3396, await pp(AM));
  // 保険価額率を変える：100%
  await ui(AM, '.ins-k', 100); await p.waitForTimeout(150);
  ok('保険価額率を 100% にすると 1,234,567 × 0.25% ＝ 3,087 に（3,086.4 → 3,087）', (await pp(AM)) === 3087, await pp(AM));
  await ui(AM, '.ins-k', 110); await p.waitForTimeout(100);

  // 3) 売値は乗せ幅で上乗せ・最低保険料（仕入 MIN）
  await set('mk', A, 500); await p.waitForTimeout(150);
  ok('売単価＝仕入単価＋乗せ幅（3,396＋500）', (await p.evaluate(i => parseFloat(document.getElementById('bp-' + i).value), AM)) === 3896);
  await set('ppmin', A, 5000); await p.waitForTimeout(150);
  const prof = await p.evaluate(i => (document.querySelector('#pr-' + i + ' .pr-main') || document.getElementById('pr-' + i))?.textContent || '', AM);
  ok('最低保険料（仕入 MIN）を設定しても、保険料の計算は崩れない（仕入単価はそのまま）', (await pp(AM)) === 3396);
  await set('ppmin', A, ''); await p.waitForTimeout(100);

  // 4) 外貨：貨物価額 USD 10,000 → 保険料 USD 33 を円へ換算
  const usdJpy = await p.evaluate(() => toJPY(1, 'USD'));
  await ui(AM, '.ins-c', 'USD'); await ui(AM, '.ins-v', 10000); await ui(AM, '.ins-r', 0.3); await ui(AM, '.ins-k', 110); await p.waitForTimeout(250);
  const expect = Math.ceil(33 * usdJpy - 1e-9);
  ok('貨物価額が USD で仕入通貨が JPY のとき、換算して切り上げ（USD 33 → 円）', (await pp(AM)) === expect, { got: await pp(AM), expect, usdJpy });
  ok('説明に換算後の円が出る', /≈ JPY/.test(await hint(AM)) && /保険料 USD 33/.test(await hint(AM)), await hint(AM));
  // 為替レートを変えると追従（updateFxRate → recalcPctRows → 保険料の行も計算し直す）
  const rate0 = usdJpy;
  await p.evaluate(r => window.updateFxRate('USD', r), rate0 + 10); await p.waitForTimeout(250);
  const expect2 = Math.ceil(33 * (rate0 + 10) - 1e-9);
  ok('為替レートを変えると、外貨の貨物価額の保険料（円）も計算し直される', (await pp(AM)) === expect2, { got: await pp(AM), expect2 });
  await p.evaluate(r => window.updateFxRate('USD', r), rate0); await p.waitForTimeout(150);
  await ui(AM, '.ins-c', 'JPY'); await ui(AM, '.ins-v', 1000000); await ui(AM, '.ins-r', 0.3); await p.waitForTimeout(150);

  // 5) 保存 → 復元
  await p.evaluate(() => { const d = JSON.parse(JSON.stringify(gatherAllData())); _applyQuoteData(d); }); await p.waitForTimeout(900);
  let A2 = (await rowIds())[0];
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

  // 6b) インボイス価格の表記（御見積書・プレビュー・メール本文の保険料の明細へ「インボイス価格 ○○円として」）
  await ui(A2, '.ins-v', 1000000); await p.waitForTimeout(150);
  const invOf = id => p.evaluate(i => window.rowInsInvoice(i), id);
  ok('既定で表記は ON（チェック済み）・インボイス価格 JPY 1,000,000', (await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-iv').checked, A2)) && JSON.stringify(await invOf(A2)) === '{"c":"JPY","v":1000000}', await invOf(A2));
  ok('文面（日本語・円）：インボイス価格 1,000,000円として', (await p.evaluate(i => window.insInvoiceText(window.rowInsInvoice(i), false), A2)) === 'インボイス価格 1,000,000円として');
  ok('文面（日本語・外貨）：インボイス価格 USD 50,000として', (await p.evaluate(() => window.insInvoiceText({ c: 'USD', v: 50000 }, false))) === 'インボイス価格 USD 50,000として');
  ok('文面（英語）：Based on invoice value of USD 50,000', (await p.evaluate(() => window.insInvoiceText({ c: 'USD', v: 50000 }, true))) === 'Based on invoice value of USD 50,000');
  ok('集計の行データ（collectAllRows）に insInv が入る', await p.evaluate(i => { const r = collectAllRows().find(x => x._type === 'data' && x.insInv); return !!r && r.insInv.v === 1000000; }, A2));
  const doc = await p.evaluate(() => buildQuoteDocHTML());
  ok('御見積書（日本語）の保険料の行にインボイス価格が出る', /<div class="qd-ins-inv">インボイス価格 1,000,000円として<\/div>/.test(doc));
  const clip = []; await p.evaluate(() => { window.__clip = ''; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
  await p.evaluate(() => window.copyQuoteEmail()); await p.waitForTimeout(250);
  ok('メール本文の保険料の行にインボイス価格が出る', /インボイス価格 1,000,000円として/.test(await p.evaluate(() => window.__clip)), await p.evaluate(() => window.__clip));
  await p.evaluate(() => { const o = document.getElementById('previewOverlay'); typeof openPreview === 'function' && openPreview(); if (!document.getElementById('previewOverlay')?.classList.contains('open') && typeof pvWarnGuideSkip === 'function') pvWarnGuideSkip(); }); await p.waitForTimeout(500);
  ok('プレビューの保険料の行にインボイス価格が出る', await p.evaluate(() => !!document.querySelector('.pv-ins-inv')), await p.evaluate(() => ({ open: document.getElementById('previewOverlay')?.className, n: document.querySelectorAll('#previewOverlay tr').length })));
  await p.evaluate(() => { const o = document.getElementById('previewOverlay'); o && o.classList.remove('open'); });
  // 保存→復元で ON のまま／OFF にすると出ない・復元しても OFF のまま
  await p.evaluate(i => { const c = document.querySelector('#row-' + i + ' .ins-iv'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }, A2); await p.waitForTimeout(200);
  { const inv = await invOf(A2), d2 = await p.evaluate(() => buildQuoteDocHTML());
    const nDiv = (d2.match(/<div class="qd-ins-inv"/g) || []).length;
    const nExp = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].filter(t => window.rowInsInvoice(t.id.replace('row-', ''))).length);
    ok('表記を OFF にするとその行のインボイス価格は出力に出ない（複製した ON の行だけ残る）', inv === null && nDiv === nExp && nExp === 1, { inv, nDiv, nExp }); }
  ok('OFF にしても保険料の計算結果（仕入単価 3,300 のまま）は変わらない', (await pp(A2)) === 3300 || (await pp(A2)) > 0);
  await p.evaluate(() => { const d = JSON.parse(JSON.stringify(gatherAllData())); _applyQuoteData(d); }); await p.waitForTimeout(900);
  const A3 = (await rowIds())[0];
  ok('保存→復元しても OFF のまま', (await invOf(A3)) === null && !(await p.evaluate(i => document.querySelector('#row-' + i + ' .ins-iv').checked, A3)));
  await p.evaluate(i => { const c = document.querySelector('#row-' + i + ' .ins-iv'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }, A3); await p.waitForTimeout(200);
  ok('ON に戻すとまた出る', (await invOf(A3)) !== null);
  // 英語出力
  await p.evaluate(() => { localStorage.setItem('quoteDocLangEn_v1', '1'); }); await p.waitForTimeout(100);
  const docEn = await p.evaluate(() => buildQuoteDocHTML());
  ok('御見積書（英語出力）は Based on invoice value of …', /qd-ins-inv">Based on invoice value of JPY 1,000,000</.test(docEn), (docEn.match(/qd-ins-inv[^<]*</) || [])[0]);
  await p.evaluate(() => { localStorage.setItem('quoteDocLangEn_v1', '0'); });
  A2 = A3;

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
