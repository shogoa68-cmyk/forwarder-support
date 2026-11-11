// 全体リマークの引き出し：存在を知らせる「跳ねる」合図（Dock のアイコン風）の試験。
//   node scripts/design-tests/remark-nudge-test.js   （THEME=1 Industry／MODE=simple かんたん／W=390 スマホ幅）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = process.env.OUT || require('os').tmpdir() + '/design-tests-out'; fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const W = +process.env.W || 1500, H = 900, narrow = W < 700;
  const ctx = await b.newContext({ viewport: { width: W, height: H }, locale: 'ja-JP', hasTouch: false });
  await ctx.addInitScript((mode) => { try { localStorage.setItem('fwd.uiMode', mode); localStorage.removeItem('quoteRemarkSheetH_v1'); } catch (e) {} }, process.env.MODE || 'detail');
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  // 合図の記録：クラスの付与・パネルの縦の動き・取っ手の高さ・持ち上げ量・ドックの位置を 30ms ごとに控える
  await p.evaluate(() => {
    const s = document.getElementById('rmSheet'), panel = s.querySelector('.rms-panel'), dock = document.getElementById('quoteActionDock');
    const rec = window.__rec = { added: 0, ty: [], handleH: new Set(), lift: new Set(), dockB: new Set() };
    new MutationObserver(() => { if (s.classList.contains('is-nudging')) rec.added++; }).observe(s, { attributes: true, attributeFilter: ['class'] });
    setInterval(() => {
      if (!s.classList.contains('is-nudging')) return;
      const m = new DOMMatrixReadOnly(getComputedStyle(panel).transform === 'none' ? undefined : getComputedStyle(panel).transform);
      rec.ty.push(+m.m42.toFixed(1)); rec.handleH.add(Math.round(document.getElementById('rmsHandle').getBoundingClientRect().height));
      rec.lift.add(document.documentElement.style.getPropertyValue('--rms-lift')); rec.dockB.add(Math.round(dock.getBoundingClientRect().bottom));
    }, 30);
  });
  await p.evaluate(() => window.qpNewQuote());
  await p.waitForTimeout(600);
  ok('見積入力画面が出た直後（1.2 秒たつ前）はまだ動かない', (await p.evaluate(() => window.__rec.added)) === 0);
  await p.waitForTimeout(1600);
  let rec = await p.evaluate(() => ({ ...window.__rec, handleH: [...window.__rec.handleH], lift: [...window.__rec.lift], dockB: [...window.__rec.dockB] }));
  ok('見積入力画面が出て約 1 秒後に、取っ手が跳ねはじめる', rec.added >= 1, rec);
  const mn = Math.min(...rec.ty), ups = rec.ty.filter((v, i, a) => i > 0 && i < a.length - 1 && v < a[i - 1] && v <= a[i + 1] && v < -2);
  ok('いちばん高いところで 15px 以上跳ね上がる', mn <= -15 && mn >= -30, mn);
  // 跳ねの山：だんだん小さくなる（3 回・高さが減っていく）
  const peaks = rec.ty.filter((v, i, a) => i > 0 && i < a.length - 1 && v <= a[i - 1] && v <= a[i + 1] && v < -2);
  const uniqPeaks = peaks.filter((v, i) => i === 0 || Math.abs(v - peaks[i - 1]) > 2.5);
  ok('跳ね上がりは複数回で、だんだん低くなる（Dock のアイコンのように）', uniqPeaks.length >= 3 && uniqPeaks[0] < uniqPeaks[1] && uniqPeaks[1] < uniqPeaks[uniqPeaks.length - 1], { peaks: uniqPeaks });
  ok('動いている間も、バーの高さ・持ち上げ量・保存ドックの位置は変わらない（transform だけ）', rec.handleH.length === 1 && rec.lift.length === 1 && rec.dockB.length === 1, rec);
  await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/rms-nudge-end.png' });
  const after = await p.evaluate(() => ({ cls: document.getElementById('rmSheet').classList.contains('is-nudging'), t: getComputedStyle(document.querySelector('#rmSheet .rms-panel')).transform }));
  ok('終わると元の位置に戻り、合図のクラスも外れる', !after.cls && (after.t === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(after.t)), after);
  // 条件：いつ跳ねてよいか
  await p.evaluate(() => { const a = document.activeElement; a && a.blur && a.blur(); });
  ok('rmsNudge()：閉じていて未入力なら跳ねる', await p.evaluate(() => window.rmsNudge()) === true);
  await p.waitForTimeout(1400);
  await p.focus('#qf-customer');
  ok('入力欄に文字を打っているあいだは跳ねない', await p.evaluate(() => window.rmsNudge()) === false);
  await p.evaluate(() => document.activeElement.blur());
  await p.evaluate(() => { const t = document.getElementById('remarkTextarea'); t.value = 'すでに書いてある'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('リマークがすでに入力されているときは跳ねない', await p.evaluate(() => window.rmsNudge()) === false);
  await p.evaluate(() => { const t = document.getElementById('remarkTextarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('入力を消して未入力に戻れば、また跳ねてよい', await p.evaluate(() => window.rmsNudge()) === true);
  await p.waitForTimeout(1400);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  ok('「視差効果を減らす」設定のときは跳ねない', await p.evaluate(() => window.rmsNudge()) === false);
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  // ダッシュボードへ戻ると止まり、戻ってくるとまた最初から
  await p.evaluate(() => { document.getElementById('rmSheet').classList.add('is-nudging'); });
  // 開く：一度でも開いたら二度と跳ねない
  await p.click('#rmsHandle'); await p.waitForTimeout(500);
  ok('一度開くと「気づいた」として保存され、以後は跳ねない', await p.evaluate(() => localStorage.getItem('quoteRemarkSheetSeen_v1') === '1' && window.rmsNudge() === false && !document.getElementById('rmSheet').classList.contains('is-nudging')));
  await p.click('#rmsHandle'); await p.waitForTimeout(400);
  ok('閉じたあとも跳ねない', await p.evaluate(() => window.rmsNudge()) === false);
  // 再読み込みしても跳ねない
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => { window.__n = 0; const s = document.getElementById('rmSheet'); new MutationObserver(() => { if (s.classList.contains('is-nudging')) window.__n++; }).observe(s, { attributes: true, attributeFilter: ['class'] }); window.qpNewQuote(); });
  await p.waitForTimeout(3000);
  ok('一度開いた人は、再読み込みして見積を開き直しても跳ねない', (await p.evaluate(() => window.__n)) === 0);
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
