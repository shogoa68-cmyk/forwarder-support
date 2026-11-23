// Design 42（残りの決めごと）の回答の確認。
//   node scripts/design-tests/design42-test.js   （THEME=1 で Industry／W=390 でスマホ）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=v2`;
  const W = +process.env.W || 1440, PHONE = W <= 600, OUT = process.env.OUT;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, isMobile: PHONE, hasTouch: PHONE });
  await ctx.addInitScript(t => { try { localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('fwd.editorV2', '1'); localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: t, doc: t })); } catch (e) {} }, !!process.env.THEME);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(900);
  const vis = sel => p.evaluate(s => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }, sel);

  // ===== 1・2：プレビュー =====
  await p.evaluate(() => window.editorV2Go(4, true)); await p.waitForTimeout(300);
  await p.evaluate(() => { const tr = document.querySelector('#tableBody tr:not([data-virtual]):not([data-type])'); const f = (n, v) => { const e = tr.querySelector(`[data-field="${n}"]`); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }; f('nm', '海上運賃'); f('sv', 'ONE'); f('un', '20GP'); f('pq', '2'); f('pc', 'USD'); f('pp', '1000'); f('bc', 'USD'); f('mk', '200'); });
  await p.evaluate(() => { document.getElementById('qf-ref').value = '99-261123-001'; document.getElementById('qf-customer').value = '山田商事'; });
  await p.waitForTimeout(400);
  const openPv = async () => { await p.evaluate(() => { window.openPreview(); const b = [...document.querySelectorAll('#pvWarnGuide button')].find(x => /このまま/.test(x.textContent)); if (b && !document.querySelector('#previewOverlay.open')) b.click(); }); await p.waitForTimeout(800); };
  await openPv();
  const heads = await p.evaluate(() => [...document.querySelectorAll('#previewTable thead tr:not(.pv-hgrp) th')].filter(t => getComputedStyle(t).display !== 'none').length);
  ok('1：既定の列は 14（CD・円換算・消費税は出さない）', heads === 14, heads);
  ok('1：CD・円換算・消費税のスイッチは既定でオフ', await p.evaluate(() => ['cd', 'jpy-conv', 'tax-col'].every(k => !document.querySelector(`.pv-col-chk[data-col="${k}"]`).checked)));
  ok('1：円換算がオフのとき、外貨の小計の横に「≈¥」', await p.evaluate(() => { const h = document.querySelector('#previewTable tbody td.pv-subtotal .pv-jpy-hint'); return !!h && getComputedStyle(h).display !== 'none' && /≈¥/.test(h.textContent); }));
  ok('1：Excel・CSV の列は今までどおり（円換算・CD を含む）', await p.evaluate(() => { const v = window.getPreviewVisibility ? window.getPreviewVisibility() : null; return !v || (v['jpy-conv'] && v['tax-col'] && v.pay); }));
  if (!PHONE) {
    await p.evaluate(() => { const c = document.querySelector('.pv-col-chk[data-col="jpy-conv"]'); c.click(); });
    await p.waitForTimeout(200);
    ok('1：自分で円換算を出すと覚える（小計の横の ≈¥ は重ねない）', await p.evaluate(() => JSON.parse(localStorage.getItem('pvColTouched_v1') || '{}')['jpy-conv'] === 1 && getComputedStyle(document.querySelector('#previewTable tbody td.pv-subtotal .pv-jpy-hint')).display === 'none'));
    await p.evaluate(() => { document.querySelector('.pv-col-chk[data-col="jpy-conv"]').click(); });
  }
  if (PHONE) {
    const hd = await p.evaluate(() => { const h = document.querySelector('#previewBox .pv-main-head'); const r = h.getBoundingClientRect(); const bs = [...h.querySelectorAll('button')].filter(x => x.getClientRects().length && getComputedStyle(x).display !== 'none'); return { h: Math.round(r.height), btns: bs.map(x => x.textContent.trim()), tops: [...new Set(bs.map(x => Math.round(x.getBoundingClientRect().top)))], min: Math.min(...bs.map(x => x.getBoundingClientRect().height)) }; });
    ok('2：上は 1 行（56px）', hd.h <= 60 && hd.tops.length === 1, hd);
    ok('2：［⚙ 設定］［⋯］［PDF 出力］［✕ 閉じる］だけ（印刷は出さない）', JSON.stringify(hd.btns) === JSON.stringify(['⚙ 設定', '⋯', '📄 PDF 出力', '閉じる']), hd.btns);
    ok('2：ボタンは 44px 以上', hd.min >= 44, hd);
    await p.click('#pvMoreBtn'); await p.waitForTimeout(150);
    ok('2：［⋯］の中は メール本文・Excel', await p.evaluate(() => [...document.querySelectorAll('#pvMoreMenu button')].map(b => b.textContent).join('|') === '✉ メール本文|📊 Excel'));
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok('2：Esc で［⋯］だけ閉じる（プレビューは開いたまま）', await p.evaluate(() => document.getElementById('pvMoreMenu').hidden && !!document.querySelector('#previewOverlay.open')));
    ok('2：見積番号・お客様は 1 行の要約', await p.evaluate(() => /99-261123-001 · 山田商事/.test(document.getElementById('pvPhSum').textContent)) && !(await vis('#pvMeta')));
    ok('2：発行日・有効期限の欄は ⚙ の中', await p.evaluate(() => !!document.querySelector('#previewBox .pv-rail #pvDateEdit')));
    if (OUT) await p.screenshot({ path: OUT + '/d42-preview-phone.png' });
  } else if (OUT) await p.screenshot({ path: OUT + '/d42-preview-pc.png' });
  await p.evaluate(() => window.closePreview()); await p.waitForTimeout(300);

  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件 FAIL` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
