// 案（パターン）をブラウザのタブのように扱う：常時表示・FCL/LCL/AIR・案ごとの貿易条件・改名・並べ替え・削除・保存→復元・出力の併記。架空データ・外部接続なし。
//   node scripts/design-tests/case-tabs-test.js        （既定は Industry／CLASSIC=1 で現行）
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
  const ctx = await b.newContext({ viewport: { width: +(process.env.W || 1400), height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  await ctx.addInitScript(cl => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify(cl ? { site: false, doc: false } : { site: true, doc: true })); } catch (e) {} }, !!process.env.CLASSIC);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); p.setDefaultTimeout(10000);
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
  const tabs = () => p.evaluate(() => [...document.querySelectorAll('#qtyPatternBar .qpat-chip')].map(c => ({ n: c.querySelector('.qpat-name,.qpat-edit')?.textContent || c.querySelector('.qpat-edit')?.value, mode: (c.querySelector('.qpat-mode') || {}).textContent || '', on: c.classList.contains('is-active') })));
  const st = () => p.evaluate(() => ({ mode: document.getElementById('cond-mode').value, inco: document.getElementById('cond-incoterms').value }));
  const setInco = v => p.evaluate(v => { const s = document.getElementById('cond-incoterms'); s.value = [...s.options].find(o => o.value.startsWith(v)).value; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);

  // 1) 1 つだけでも、タブと「＋」が出ている
  let t = await tabs();
  ok('案が 1 つのときも、タブ 1 つと「＋」が常に見える', t.length === 1 && t[0].on && await p.evaluate(() => !!document.querySelector('#qtyPatternBar .qpat-add') && document.getElementById('qtyPatternBar').offsetParent !== null), t);

  // 2) 「＋」→ FCL案／LCL案／AIR案
  await p.evaluate(() => window.setTransport('fcl')); await setInco('FOB');
  await p.evaluate(() => document.querySelector('#qtyPatternBar .qpat-add').click()); await p.waitForTimeout(150);
  ok('「＋」でメニューが開く（FCL案／LCL案／AIR案／コピー／空の案）', await p.evaluate(() => document.querySelectorAll('#qpatPop .qpat-pop-item').length === 5));
  await p.evaluate(() => document.querySelector('#qpatPop [onclick*="qpatAddAct(\'lcl\')"]').click()); await p.waitForTimeout(300);
  t = await tabs();
  ok('LCL案を追加すると、元の案にも FCL のモードが付き、LCL案のタブに切り替わる', t.length === 2 && t[0].mode === 'FCL' && t[1].mode === 'LCL' && t[1].on, t);
  ok('LCL案に切り替わると輸送モードが海上（LCL）になる', (await st()).mode === '海上（LCL）', await st());
  await p.evaluate(() => window.addModePattern('air')); await p.waitForTimeout(300);
  t = await tabs();
  ok('AIR案を追加すると、航空（AIR）に切り替わる', t.length === 3 && t[2].mode === 'AIR' && t[2].on && (await st()).mode === '航空（AIR）', { t, s: await st() });
  ok('表の色（data-qpat）が AIR になる', (await p.evaluate(() => document.getElementById('tab-quote-make').dataset.qpat)) === 'air');

  // 3) 案ごとの貿易条件
  await setInco('CIF');
  ok('AIR案で貿易条件を CIF にする', /^CIF/.test((await st()).inco), await st());
  await p.evaluate(() => window.switchPackingPattern(0)); await p.waitForTimeout(300);
  ok('FCL案に戻ると、モードも貿易条件（FOB）も FCL案のものに戻る', (await st()).mode === '海上（FCL）' && /^FOB/.test((await st()).inco), await st());
  await p.evaluate(() => window.switchPackingPattern(2)); await p.waitForTimeout(300);
  ok('AIR案に切り替えると CIF に戻る', /^CIF/.test((await st()).inco) && (await st()).mode === '航空（AIR）', await st());

  // 4) 行の「適用する貿易条件」が案ごとに効く：FOB のときだけ有効な行 → AIR案（CIF）では対象外
  await p.evaluate(() => window.switchPackingPattern(0)); await p.waitForTimeout(200);
  const rid = await p.evaluate(() => { window.addRow(); const trs = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')]; const id = trs[trs.length - 1].id.replace('row-', ''); const s = (f, v) => { const el = document.getElementById(f + '-' + id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }; s('nm', 'FOB限定費用'); s('pq', '1'); s('pp', '100'); s('ic', 'FOB'); window.syncIcUi && window.syncIcUi(id); return id; });
  const outRange = () => p.evaluate(id => document.getElementById('row-' + id).dataset.outRange === '1', rid);
  ok('FOB の案では、FOB 限定の行は有効', !(await outRange()));
  await p.evaluate(() => window.switchPackingPattern(2)); await p.waitForTimeout(300);
  ok('CIF の AIR案では、FOB 限定の行は適用期間外になる', await outRange());
  // 出力：案ごとの貿易条件で行の判定が引き直される
  const views = await p.evaluate(() => window.getOutputPatternViews());
  ok('FCL・LCL・AIR の案があると、出力は案を併記する対象になる', Array.isArray(views) && views.length === 3 && views.map(v => v.mode).join() === 'fcl,lcl,air', views);
  const inView = await p.evaluate(() => { const r = {}; [0, 2].forEach(i => { r[i] = window.withPatternView(i, () => { const row = window.collectAllRows().find(x => x._type === 'data' && x.name === 'FOB限定費用'); return row ? !row._hideQuote : null; }); }); return r; });
  ok('出力用の表示：FCL案（FOB）では行が出て、AIR案（CIF）では外れる', inView[0] === true && inView[2] === false, inView);
  ok('出力用の表示のあとも、画面の貿易条件・モードは元のまま（AIR・CIF）', (await st()).mode === '航空（AIR）' && /^CIF/.test((await st()).inco), await st());

  // 5) 改名（ダブルクリック）・Esc で取り消し
  await p.evaluate(() => { const c = document.querySelectorAll('#qtyPatternBar .qpat-chip')[1]; c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }); await p.waitForTimeout(150);
  ok('ダブルクリックで名前の入力欄になる', await p.evaluate(() => !!document.querySelector('#qtyPatternBar .qpat-edit')));
  await p.evaluate(() => { const i = document.querySelector('#qtyPatternBar .qpat-edit'); i.value = '混載（神戸）'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); await p.waitForTimeout(200);
  t = await tabs();
  ok('Enter で改名が確定する', t[1].n === '混載（神戸）', t);
  await p.evaluate(() => { const c = document.querySelectorAll('#qtyPatternBar .qpat-chip')[1]; c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); const i = document.querySelector('#qtyPatternBar .qpat-edit'); i.value = '消える'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); await p.waitForTimeout(200);
  t = await tabs();
  ok('Esc で改名は取り消される', t[1].n === '混載（神戸）', t);

  // 6) 並べ替え：編集中の案（AIR案）は動かしても編集中のまま
  await p.evaluate(() => window.qpatReorder(2, 0)); await p.waitForTimeout(200);
  t = await tabs();
  ok('AIR案を先頭へ並べ替えても、AIR案が編集中のまま', t[0].mode === 'AIR' && t[0].on && t.length === 3, t);
  ok('並べ替えても輸送モード・貿易条件は変わらない', (await st()).mode === '航空（AIR）' && /^CIF/.test((await st()).inco), await st());

  // 7) 保存 → 復元：タブの順・名前・モード・貿易条件
  const snap = await p.evaluate(() => JSON.parse(JSON.stringify(gatherAllData())));
  await p.evaluate(d => { _applyQuoteData(d); }, snap); await p.waitForTimeout(900);
  t = await tabs();
  ok('保存→開き直しても、タブの順・名前・モードが残る', t.length === 3 && t[0].mode === 'AIR' && t[1].mode === 'FCL' && t[2].n === '混載（神戸）' && t[0].on, t);
  await p.evaluate(() => window.switchPackingPattern(1)); await p.waitForTimeout(300);
  ok('復元後も FCL案の貿易条件（FOB）が案ごとに残る', /^FOB/.test((await st()).inco) && (await st()).mode === '海上（FCL）', await st());

  // 8) メニュー（⋯）：モード変更・削除
  await p.evaluate(() => document.querySelector('#qtyPatternBar .qpat-more').click()); await p.waitForTimeout(150);
  ok('「⋯」のメニューに、名前・モード・複製・見積書の表示・削除が出る', await p.evaluate(() => /名前を変更/.test(document.getElementById('qpatPop').textContent) && /複製/.test(document.getElementById('qpatPop').textContent) && /削除/.test(document.getElementById('qpatPop').textContent) && document.querySelectorAll('#qpatPop .qpat-pop-mode').length === 4));
  await p.evaluate(() => document.querySelector('#qpatPop [onclick*="qpatMenuAct(\'del\')"]').click()); await p.waitForTimeout(300);
  t = await tabs();
  ok('メニューから削除すると、タブが 1 つ減る', t.length === 2, t);
  await p.evaluate(() => { const x = document.querySelectorAll('#qtyPatternBar .qpat-x')[0]; x && x.click(); }); await p.waitForTimeout(300);
  t = await tabs();
  ok('タブの × でも削除できる（最後の 1 つは × が出ない）', t.length === 1 && await p.evaluate(() => !document.querySelector('#qtyPatternBar .qpat-x')), t);

  ok('JS エラーなし', errs.length === 0, errs);
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'FAIL あり' : 'ALL PASS');
  await b.close(); srv.close();
})();
