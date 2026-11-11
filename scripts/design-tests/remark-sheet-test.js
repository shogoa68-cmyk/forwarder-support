// 全体リマーク・免責事項＝画面下の引き出し（ボトムシート）の試験。
//   node scripts/design-tests/remark-sheet-test.js   （THEME=1 Industry／MODE=simple かんたん／W=390 スマホ幅）
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
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);
  const st = () => p.evaluate(() => { const g = id => document.getElementById(id), r = e => e.getBoundingClientRect(); const s = g('rmSheet'), body = g('rmsBody'), h = g('rmsHandle'), dock = g('quoteActionDock'), ta = g('remarkTextarea'); const sr = r(s), dr = r(dock);
    return { sheetBottom: Math.round(sr.bottom), sheetTop: Math.round(sr.top), vh: innerHeight, handleH: Math.round(r(h).height), bodyH: Math.round(r(body).height), exp: h.getAttribute('aria-expanded'), taVisible: r(ta).height > 0 && getComputedStyle(body).visibility !== 'hidden', dockBottom: Math.round(dr.bottom), dockTop: Math.round(dr.top), lift: getComputedStyle(document.documentElement).getPropertyValue('--rms-lift').trim(), meta: g('rmsMeta').textContent.trim() }; });
  let s = await st();
  ok('閉じているとき：画面最下部に細い取っ手バーだけ', s.sheetBottom === s.vh && s.handleH >= 34 && s.handleH <= 44 && s.bodyH === 0 && s.exp === 'false' && !s.taVisible, s);
  ok('全体リマークは見積もりテーブルの下のセクションではなく、引き出しの中にある', await p.evaluate(() => { const sec = document.getElementById('section-remark'); return !!sec && !!sec.closest('#rmsBody') && !document.querySelector('#tab-quote-make .quote-main #section-remark'); }));
  ok('取っ手に「未入力」と出る', /未入力/.test(s.meta), s.meta);
  ok('保存ドックは取っ手の上に避けている', s.dockBottom <= s.sheetTop + 1, s);
  const closedDockTop = s.dockTop;
  // クリックで開く
  await p.click('#rmsHandle'); await p.waitForTimeout(500); s = await st();
  const half = Math.round(H * 0.5 - 36);
  ok('取っ手を押すと下から半分ほどの高さで開く（文章欄が見える）', s.exp === 'true' && Math.abs(s.bodyH - half) <= 40 && s.taVisible, { s, half });
  ok('開いても保存ドックは引き出しに追従して持ち上がらない（閉じているときと同じ位置）', s.dockTop === closedDockTop && +s.lift.replace('px', '') >= s.bodyH + 30, { s, closedDockTop });
  const behind = await p.evaluate(() => {
    const dock = document.getElementById('quoteActionDock'), sp = document.querySelector('#rmSheet .rms-panel').getBoundingClientRect();
    const zs = getComputedStyle(document.getElementById('rmSheet')).zIndex, zd = getComputedStyle(dock).zIndex;
    const res = [...dock.querySelectorAll('.qad-btn')].map(b => { const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
      const under = x > sp.left && x < sp.right && y > sp.top;      // 引き出しと重なる位置
      return { under, ok: under ? !!(top && top.closest('#rmSheet')) : !!(top && top.closest('#quoteActionDock')) }; });
    return { zs: +zs, zd: +zd, res };
  });
  ok('開いているあいだ、ドックは引き出しの裏に隠れる（重なるボタンは引き出しが上・重ならないボタンは見えたまま押せる）', behind.zd < behind.zs && behind.res.every(r => r.ok), behind);
  ok('開いても背景（上の入力欄）は操作できる（引き出しが覆わない）', await p.evaluate(async () => { const el = document.getElementById('qf-customer'); window.scrollBy(0, el.getBoundingClientRect().top - 260); await new Promise(r => setTimeout(r, 250)); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + 20, r.top + r.height / 2); return { onTop: t === el, y: Math.round(r.top) }; }).then(x => x.onTop), 'elementFromPoint');
  await p.fill('#qf-customer', 'ABC商事'); ok('開いたまま上の欄に入力できる', (await p.inputValue('#qf-customer')) === 'ABC商事');
  // 入力・定型文・保存
  await p.fill('#remarkTextarea', 'テスト用の免責事項です'); await p.waitForTimeout(150);
  ok('入力すると取っ手に文字数と印が出る', await p.evaluate(() => /11文字|1\d文字/.test(document.getElementById('rmsMeta').textContent) && document.querySelector('#rmsMeta .rms-dot')), await st());
  const preset = await p.evaluate(() => { const b = document.querySelector('#presetBtns button'); if (!b) return null; b.click(); return document.getElementById('remarkTextarea').value.length; });
  ok('定型文ボタンが引き出しの中で従来どおり動く（文章が追記される）', preset > 11, preset);
  ok('保存データ（gatherAllData）に全体リマークが入る', await p.evaluate(() => JSON.stringify(gatherAllData()).includes('テスト用の免責事項')));
  await p.screenshot({ path: OUT + '/remark-sheet-open.png' });
  // Esc で閉じる
  await p.focus('#remarkTextarea'); await p.keyboard.press('Escape'); await p.waitForTimeout(450); s = await st();
  ok('Esc で閉じる（文章は残る）', s.exp === 'false' && s.bodyH === 0 && await p.evaluate(() => document.getElementById('remarkTextarea').value.includes('テスト用')), s);
  // 上へドラッグして開く
  const hb = await p.evaluate(() => { const r = document.getElementById('rmsHandle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(hb.x, hb.y); await p.mouse.down(); await p.mouse.move(hb.x, hb.y - 100, { steps: 6 }); await p.mouse.move(hb.x, hb.y - 300, { steps: 8 });
  const mid = await st();
  await p.mouse.up(); await p.waitForTimeout(500); s = await st();
  ok('上へドラッグすると指に合わせて高さが伸び、離すと開いたままになる', mid.bodyH > 150 && s.exp === 'true' && Math.abs(s.bodyH - 300) <= 20, { mid, s });
  // つまみを下へ引いて小さくする／さらに下げて閉じる
  const hb2 = await p.evaluate(() => { const r = document.getElementById('rmsHandle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(hb2.x, hb2.y); await p.mouse.down(); await p.mouse.move(hb2.x, hb2.y + 120, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(450); s = await st();
  ok('開いたあと下へドラッグすると高さが小さくなる', s.exp === 'true' && s.bodyH >= 140 && s.bodyH < 300, s);
  const hb3 = await p.evaluate(() => { const r = document.getElementById('rmsHandle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(hb3.x, hb3.y); await p.mouse.down(); await p.mouse.move(hb3.x, hb3.y + 400, { steps: 10 }); await p.mouse.up(); await p.waitForTimeout(450); s = await st();
  ok('大きく引き下げると閉じる', s.exp === 'false' && s.bodyH === 0, s);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(0);
  // ナビ
  await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1000);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(700);
  ok('左端ナビの並び：…→費用→リマーク', await p.evaluate(() => [...document.querySelectorAll('#qSecNav .q-secnav-btn')].map(b => b.dataset.sec.replace('section-', '')).join(',')) === 'ref,cond,cargo,volume,scope,table,remark');
  await p.click('#qSecNav [data-sec="section-remark"]', { force: true }); await p.waitForTimeout(500); s = await st();
  ok('ナビの「リマーク」で引き出しが開く', s.exp === 'true' && s.taVisible, s);
  // 閲覧モード
  await p.evaluate(() => rmsApplyMode(true));
  const vm = await p.evaluate(() => ({ ro: document.getElementById('remarkTextarea').readOnly, presetInert: document.getElementById('presetBtns').closest('[inert]') != null || document.getElementById('presetBtns').inert }));
  ok('閲覧モード：文章は読むだけ・定型文は押せない（開閉はできる）', vm.ro && vm.presetInert, vm);
  await p.evaluate(() => rmsApplyMode(false)); await p.click('#rmsHandle'); await p.waitForTimeout(450);
  ok('閲覧モードを戻すと編集できる・取っ手で閉じられる', (await st()).exp === 'false' && await p.evaluate(() => !document.getElementById('remarkTextarea').readOnly));
  // 合計バー（画面下固定）は引き出しの上へ避ける
  await p.evaluate(async () => { for (let i = 0; i < 25; i++) addRow(); document.getElementById('tableScrollWrap').scrollIntoView({ block: 'start' }); window.scrollBy(0, 120); await new Promise(r => setTimeout(r, 400)); });
  const tf = async () => p.evaluate(() => { const t = document.getElementById('totFloat'), sh = document.getElementById('rmSheet'); return { shown: !t.hidden, tb: Math.round(t.getBoundingClientRect().bottom), st: Math.round(sh.getBoundingClientRect().top), vh: innerHeight, z: +getComputedStyle(t).zIndex, sz: +getComputedStyle(sh).zIndex }; });
  let t1 = await tf();
  const closedTb = t1.tb;
  ok('合計バーは閉じた引き出し（取っ手）の上に出る', !t1.shown || t1.tb <= t1.st + 1, t1);
  await p.click('#rmsHandle'); await p.waitForTimeout(600); await p.evaluate(() => window.scrollBy(0, 5)); await p.waitForTimeout(300);
  t1 = await tf();
  ok('引き出しを開いても、合計バーは追従して持ち上がらない（閉じているときと同じ位置・引き出しの裏）', !t1.shown || (t1.tb === closedTb && t1.z < t1.sz), { t1, closedTb });
  await p.click('#rmsHandle'); await p.waitForTimeout(450);
  // 他のタブ・ダッシュボードでは出さない
  await p.evaluate(() => document.body.classList.add('qp-dash-active')); await p.waitForTimeout(150);
  ok('ダッシュボードでは出ない（持ち上げも 0）', await p.evaluate(() => getComputedStyle(document.getElementById('rmSheet')).display === 'none'));
  await p.evaluate(() => document.body.classList.remove('qp-dash-active'));
  await p.evaluate(() => { const b = document.querySelector('.cat-btn[aria-controls="tab-bookmark"]'); b && b.click(); }); await p.waitForTimeout(500);
  ok('ほかのタブでは出ず、🐞 も持ち上がらない', await p.evaluate(() => document.getElementById('rmSheet').getClientRects().length === 0 && getComputedStyle(document.documentElement).getPropertyValue('--rms-lift').trim() === '0px'));
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
