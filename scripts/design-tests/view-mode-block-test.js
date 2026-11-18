// 閲覧モード（qmode-view）では、右の引き出しの費用ツリーと案バーから行・案を変えられない。架空データ・外部接続なし。
//   node scripts/design-tests/view-mode-block-test.js        （THEME=1 で Industry）
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
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(th => { try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('forwarderTheme_v1', JSON.stringify(th ? { site: true, doc: true } : { site: false, doc: false })); } catch (e) {} }, !!process.env.THEME);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept('X案'));
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(600);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1000);
  await p.evaluate(() => { window.addRow(); window.addRow(); document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').forEach(t => { const el = document.getElementById('sv-' + t.id.replace('row-', '')); if (el) { el.value = 'A社'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } }); }); await p.waitForTimeout(500);
  const rows = () => p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').length);
  const pats = () => p.evaluate(() => _packingPatterns.length);
  const hid = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].filter(t => t.dataset.hideQuote === '1').length);
  // 編集モードでは効く（比較の土台）
  const r0 = await rows();
  await p.evaluate(s => document.querySelector(s).click(), '.qsp-dig-grp-add'); await p.waitForTimeout(300);
  ok('編集モード：費用ツリーの「行追加」で行が増える', (await rows()) === r0 + 1, await rows());
  // 閲覧モードへ（_applyShareMode('view') と同じ印）
  await p.evaluate(() => { document.querySelector('#tab-quote-make .quote-main').inert = true; document.getElementById('tab-quote-make').classList.add('qmode-view'); });
  const r1 = await rows(), p1 = await pats();
  await p.evaluate(s => document.querySelector(s).click(), '.qsp-dig-grp-add'); await p.waitForTimeout(300);
  ok('閲覧モード：費用ツリーの「行追加」で行が増えない', (await rows()) === r1, await rows());
  await p.evaluate(s => document.querySelector(s).click(), '.qsp-dig-row-hide'); await p.waitForTimeout(200);
  ok('閲覧モード：「見積書に出さない」を切り替えられない', (await hid()) === 0, await hid());
  await p.evaluate(s => document.querySelector(s).click(), '.qpat-add'); await p.waitForTimeout(200);
  ok('閲覧モード：案の「＋」メニューが開かない', !(await p.evaluate(() => !!document.querySelector('.qpat-pop'))));
  await p.evaluate(s => document.querySelector(s).click(), '.qpat-more'); await p.waitForTimeout(200);
  ok('閲覧モード：案の「⋯」メニューが開かない', !(await p.evaluate(() => !!document.querySelector('.qpat-pop'))));
  await p.evaluate(() => document.querySelector('.qpat-chip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))); await p.waitForTimeout(200);
  ok('閲覧モード：案の名前を書き換える欄が出ない', !(await p.evaluate(() => !!document.querySelector('.qpat-edit'))));
  ok('閲覧モード：案の数は変わらない', (await pats()) === p1, await pats());
  ok('JSエラーなし', errs.length === 0, errs);
  console.log(out.join('\n')); await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
