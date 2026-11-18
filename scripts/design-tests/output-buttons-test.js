// 新画面の出力まわり：保存の未保存の点・編集と保存の分離・ステップ⑤の出力パネル。  node scripts/design-tests/output-buttons-test.js  （THEME=1／W=390）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const W = +process.env.W || 1400;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, isMobile: W <= 600, hasTouch: W <= 600 });
  await ctx.addInitScript(t => { try { localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('fwd.editorV2', '1'); localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: t, doc: t })); } catch (e) {} }, !!process.env.THEME);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(900);
  const info = () => p.evaluate(() => { const d = document.getElementById('quoteActionDock'), mb = document.getElementById('qadMode'), eb = document.getElementById('e2EditBtn'); const vis = e => !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; return { pdf: vis(d.querySelector('.qad-pdf')), pv: vis(d.querySelector('.qad-preview')), save: vis(mb), saveText: mb.textContent.trim(), saveDis: mb.disabled, dirty: mb.classList.contains('is-dirty'), edit: vis(eb), editText: eb ? eb.textContent.trim() : '', more: !!document.getElementById('e2PvMore') }; });
  const i0 = await info();
  ok('［PDF］［プレビュー］［保存］が別々に見える・▾の入れ物は無い', i0.pdf && i0.pv && i0.save && !i0.more, i0);
  ok('保存ボタンの文字はいつも「保存」', /保存/.test(i0.saveText), i0);
  // 編集中にして、未保存の点を確かめる
  await p.evaluate(() => { const mb = document.getElementById('qadMode'); window.__e2t = 1; });
  const state = await p.evaluate(() => ({ dirtyFn: typeof window.quoteIsDirty, mode: document.getElementById('qadMode').className }));
  if (state.dirtyFn === 'function') {
    await p.evaluate(() => { const i = document.getElementById('qf-customer'); if (i) { i.value = 'テスト商事'; i.dispatchEvent(new Event('input', { bubbles: true })); } });
    await p.waitForTimeout(500);
    const i1 = await info();
    if (!i1.edit) ok('編集中で未保存のとき、保存ボタンに橙の点が付く', i1.dirty, i1);
    else ok('閲覧中は［✏️ 編集を始める］が出て、保存は押せない', i1.edit && i1.saveDis && /編集/.test(i1.editText), i1);
  }
  // ステップ⑤の出力パネル
  await p.evaluate(() => window.editorV2Go(5)); await p.waitForTimeout(400);
  const o = await p.evaluate(() => { const e = document.getElementById('e2Out'); if (!e) return null; const r = e.getBoundingClientRect(), n = document.getElementById('e2Nav').getBoundingClientRect(); return { shown: getComputedStyle(e).display !== 'none' && r.height > 0, btns: Array.from(e.querySelectorAll('button')).filter(x => !x.hidden).map(x => x.textContent.trim()), aboveNav: r.bottom <= n.top + 1 }; });
  ok('ステップ⑤の最後に出力パネル（プレビュー・PDF・保存の順）が出る', o && o.shown && o.btns.length === 4 && /プレビュー/.test(o.btns[0]) && /PDF/.test(o.btns[1]) && /一時ファイル/.test(o.btns[2]) && /保存/.test(o.btns[3]), o);
  ok('出力パネルは［戻る］［次へ］の上にある', o && o.aboveNav, o);
  let called = {};
  await p.evaluate(() => { window.__c = []; window.quickQuotePdf = () => window.__c.push('pdf'); window.openPreview = () => window.__c.push('pv'); });
  await p.evaluate(() => { document.querySelector('#e2Out [data-e2o="pdf"]').click(); document.querySelector('#e2Out [data-e2o="pv"]').click(); });
  ok('パネルのボタンは、元の関数（PDF・プレビュー）を呼ぶ', JSON.stringify(await p.evaluate(() => window.__c)) === '["pdf","pv"]');
  await p.evaluate(() => window.editorV2Go(2)); await p.waitForTimeout(300);
  ok('ほかのステップでは出力パネルを出さない', !(await p.evaluate(() => { const e = document.getElementById('e2Out'); return getComputedStyle(e).display !== 'none'; })));
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
