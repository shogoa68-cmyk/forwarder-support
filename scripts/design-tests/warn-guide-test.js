// 出力前の確認ガイド（右下）が、右下の固定ボタン（PDF出力／プレビュー／保存）や全体リマークの引き出しと重ならない試験。
//   node scripts/design-tests/warn-guide-test.js   （THEME=1 Industry／MODE=simple かんたん／W=390 スマホ幅／既定は新画面。EDITOR=v1 で旧画面（右下ドックの上に出る）／新画面＝ボタンが上部ツールバーにあるとき、ガイドはボタンの下に出る）
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
  const V1 = process.env.EDITOR === 'v1'; // 既定は新画面（2026-11〜）。旧画面は EDITOR=v1
  await ctx.addInitScript(v1 => { try { localStorage.setItem('fwd.editorV2', v1 ? '0' : '1'); } catch (e) {} }, V1);
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);
  // 品名だけ入れた 1 行（お客様・担当者などが未入力 → 確認ガイドが出る）
  await p.evaluate(() => {
    const set = (n, v) => { const el = document.querySelector(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('nm', '海上運賃'); set('sv', 'A海運'); set('un', "40'GP"); set('pq', '1'); set('pp', '1000'); set('mk', '100');
  }); await p.waitForTimeout(400);
  await p.evaluate(() => { const a = document.activeElement; a && a.blur && a.blur(); });
  const showGuide = async () => {
    await p.evaluate(() => { if (typeof pvWarnGuideClose === 'function') pvWarnGuideClose(); });
    await p.evaluate(() => { const b = [...document.querySelectorAll('#quoteActionDock .qad-btn')].find(x => /プレビュー/.test(x.textContent)); b.click(); });
    await p.waitForTimeout(400);
  };
  const geo = () => p.evaluate(() => {
    const g = document.getElementById('pvWarnGuide'); if (!g || g.style.display === 'none') return { shown: false };
    const gr = g.getBoundingClientRect(), vh = innerHeight, ox = r => r.width > 0 && r.right > gr.left && r.left < gr.right;
    const btns = [...document.querySelectorAll('#quoteActionDock .qad-btn')].map(b => b.getBoundingClientRect()).filter(ox);
    const dockTop = btns.length ? Math.min(...btns.map(r => r.top)) : null;
    const sheet = document.getElementById('rmSheet'), sp = sheet.querySelector('.rms-panel').getBoundingClientRect();
    const lift = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rms-lift')) || 0;
    const sheetTop = ox(sp) ? vh - lift : null;
    const skip = g.querySelector('.pv-wg-btn-skip'), sr = skip ? skip.getBoundingClientRect() : null;
    const hit = sr ? document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2) : null;
    return { shown: true, top: Math.round(gr.top), bottom: Math.round(gr.bottom), dockTop: dockTop == null ? null : Math.round(dockTop), sheetTop: sheetTop == null ? null : Math.round(sheetTop),
      skipClickable: !!(hit && hit.closest('.pv-wg-btn-skip')), vh };
  });
  await showGuide();
  let g = await geo();
  if (!V1 && narrow) {
    // 新画面・スマホ幅：下の固定ドックの上に出て、画面内に収まり、押せる
    ok('新画面（スマホ幅）：確認ガイドが出る', g.shown, g);
    ok('新画面（スマホ幅）：ガイドは画面内に収まり、「このまま出力」が押せる', g.shown && g.top >= 0 && g.bottom <= g.vh && g.skipClickable, g);
    ok('JS エラーなし', errs.length === 0, errs);
    await b.close(); srv.close(); console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
  }
  if (!V1 && !narrow) {
    // 新画面：ボタンは上部ツールバー。ガイドはボタンの下に出て、画面内に収まり、「このまま出力」「次の箇所へ」が押せる
    const v = await p.evaluate(() => {
      const gd = document.getElementById('pvWarnGuide'), gr = gd.getBoundingClientRect();
      const btns = [...document.querySelectorAll('#quoteActionDock .qad-btn')].map(b => b.getBoundingClientRect()).filter(r => r.width > 0);
      const below = Math.max(...btns.map(r => r.bottom)), upper = Math.min(...btns.map(r => r.top)) < innerHeight / 2;
      const hitOf = sel => { const e = gd.querySelector(sel), r = e.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(h && h.closest(sel)); };
      return { upper, below: Math.round(below), top: Math.round(gr.top), bottom: Math.round(gr.bottom), vh: innerHeight, skip: hitOf('.pv-wg-btn-skip'), next: hitOf('.pv-wg-btn-next') };
    });
    ok('新画面：ボタンが上部にある', v.upper, v);
    ok('新画面：ガイドはボタンの下に出る（上端 ≧ ボタンの下端）', v.top >= v.below, v);
    ok('新画面：ガイド全体が画面の中に収まる', v.top >= 0 && v.bottom <= v.vh, v);
    ok('新画面：「次の箇所へ」「このまま出力」が押せる', v.skip && v.next, v);
    await p.screenshot({ path: OUT + '/warn-guide-v2.png' });
    ok('JS エラーなし', errs.length === 0, errs);
    await b.close(); srv.close(); console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
  }
  ok('プレビューを押すと確認ガイドが出る', g.shown, g);
  ok('閉じた引き出しのとき：ガイドの下端は、ドックのボタンの上端より上（重ならない）', g.shown && (g.dockTop == null || g.bottom <= g.dockTop), g);
  ok('ガイドは画面の中に収まり、「このまま出力」が押せる（ボタンに隠れていない）', g.shown && g.top >= 0 && g.bottom <= g.vh && g.skipClickable, g);
  await p.screenshot({ path: OUT + '/warn-guide-closed.png' });
  // 引き出しを開いた状態
  await p.click('#rmsHandle'); await p.waitForTimeout(500);
  await showGuide(); g = await geo();
  ok('引き出しを開いているとき：ガイドは、重なるなら引き出しの上端より上・ドックの上端より上に出る', g.shown && (g.dockTop == null || g.bottom <= g.dockTop) && (g.sheetTop == null || g.bottom <= g.sheetTop), g);
  ok('開いているときも、ガイドは画面内で「このまま出力」が押せる', g.shown && g.top >= 0 && g.skipClickable, g);
  await p.screenshot({ path: OUT + '/warn-guide-open.png' });
  // 開閉のたびに追従して置き直す
  await p.click('#rmsHandle'); await p.waitForTimeout(600);
  g = await geo();
  ok('引き出しを閉じると、ガイドは下へ戻り、ドックと重ならない', g.shown && (g.dockTop == null || g.bottom <= g.dockTop), g);
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
