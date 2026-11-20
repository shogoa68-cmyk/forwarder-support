// Design 40（入力欄の 2 列の格子）・41（プレビュー／PDF 出力の役割分け）。
//   node scripts/design-tests/input-preview-test.js   （THEME=1 で Industry／W=390 でスマホ）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=v2`;
  const W = +process.env.W || 1440, PHONE = W <= 600;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, isMobile: PHONE, hasTouch: PHONE });
  await ctx.addInitScript(t => { try { localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('fwd.editorV2', '1'); localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: t, doc: t })); } catch (e) {} }, !!process.env.THEME);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(900);
  const R = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), vis: r.width > 0 && getComputedStyle(e).display !== 'none' }; }, sel);

  // ===== 40：入力欄 =====
  await p.evaluate(() => window.editorV2Go(1, true)); await p.waitForTimeout(300);
  const cu = await R('#qf-customer'), pe = await R('#qf-person'), cn = await R('#qf-case-name'), rf = await R('#qf-ref');
  ok('① 高さは 36px（スマホ 44px）', [cu, pe, cn, rf].every(x => x && x.h === (PHONE ? 44 : 36)), [cu, pe, cn, rf]);
  if (!PHONE) {
    // Design 46（案B）：①は左の列が 1 列（お客様→ご担当者→案件名→番号）。日付などは右の列（steps-b-test.js）
    ok('① 左の列は 1 列（お客様→ご担当者→案件名→番号の順）', cu.y < pe.y && pe.y < cn.y && cn.y < rf.y, { cu, pe, cn, rf });
    ok('① 右端がそろう（お客様と案件名）', Math.abs(cu.r - cn.r) <= 40, { cu, cn });
  } else ok('① スマホは 1 列（お客様→ご担当者→案件名→番号の順）', cu.y < pe.y && pe.y < cn.y && cn.y < rf.y, { cu, pe, cn, rf });
  ok('① 見出し「管理番号入力」は出さない', !(await R('#section-ref > h2')).vis);
  ok('① ご担当者の例文は「例）山田」だけ', await p.evaluate(() => document.getElementById('qf-person').placeholder === '例）山田'));
  ok('① 社内メモのボタンは案件名の見出しの中', await p.evaluate(() => !!document.querySelector('.ci-cell-case label #ciMemoBtn')));
  // 見積もり番号：値があると表示だけ＋［変更］
  ok('番号が空のときは［変更］を出さず、そのまま入力できる', !(await R('#ciRefEdit')).vis && await p.evaluate(() => !document.getElementById('qf-ref').readOnly));
  await p.fill('#qf-ref', '99-261119-001'); await p.evaluate(() => document.getElementById('qf-ref').blur()); await p.waitForTimeout(200);
  ok('番号を入れて離れると、表示だけ（自動）になり［変更］が出る', await p.evaluate(() => document.getElementById('qf-ref').readOnly) && (await R('#ciRefEdit')).vis);
  await p.click('#ciRefEdit'); await p.waitForTimeout(150);
  ok('［変更］を押すと直せる（焦点が欄に入る）', await p.evaluate(() => !document.getElementById('qf-ref').readOnly && document.activeElement.id === 'qf-ref'));
  await p.evaluate(() => document.getElementById('qf-ref').blur()); await p.waitForTimeout(200);
  // ② 国が港の左
  await p.evaluate(() => { const s = document.getElementById('cond-incoterms'); s.value = [...s.options].find(o => /FOB/.test(o.value)).value; s.dispatchEvent(new Event('change', { bubbles: true })); window.setDirection && window.setDirection('export'); window.setTransport && window.setTransport('fcl'); });
  await p.evaluate(() => window.editorV2Go(2, true)); await p.waitForTimeout(400);
  const pc = await R('#z2PolCountry'), pl = await R('#z2Pol');
  ok('② 国は港の左に隣り合わせ（同じ行）', pc && pl && pc.y === pl.y && pc.x < pl.x && pl.x - pc.r <= 12, { pc, pl });
  if (!PHONE) ok('② 国 170px・港 340px', pc.w === 170 && pl.w === 340, { pc, pl });
  ok('② 下の「インコタームズ EXW ✎」の要約は出さない', !(await R('#cfCrumbs')).vis);
  ok('② 上の帯の「貿易条件」は押すと選び直せる（✎ の印）', await p.evaluate(() => !!document.querySelector('#e2Chips2 > span[data-cf="inco"]')));
  await p.evaluate(() => document.querySelector('#e2Chips2 > span[data-cf="inco"]').click()); await p.waitForTimeout(200);
  ok('② 帯の「貿易条件」を押すと、インコタームズの選択が開く', await p.evaluate(() => { const g = document.querySelector('.cond-prim-group-inco'); return g && !g.classList.contains('cf-hide') && getComputedStyle(g).display !== 'none'; }));
  // ③ クリア・高さ・モード別
  await p.evaluate(() => window.editorV2Go(3, true)); await p.waitForTimeout(300);
  const cg = await R('#cond-cargo'), hs = await R('#cond-hs');
  ok('③ 貨物名・HS コードの高さも 36px（スマホ 44px）', cg.h === (PHONE ? 44 : 36) && hs.h === (PHONE ? 44 : 36), { cg, hs });
  ok('③ クリアは見出しの下の右・名前は「貨物・ルートの入力をクリア」', await p.evaluate(() => { const b = document.querySelector('#cargoBody > .ig-clear-row .btn-cond-clear'); return !!b && b.textContent === '貨物・ルートの入力をクリア'; }));
  ok('③ FCL はコンテナが先（荷姿は詳細の奥）', (await R('[data-field-id="container-type"]')).vis && !(await R('#section-volume .cond-field--cargo-detail')).vis);
  await p.evaluate(() => window.setTransport('lcl')); await p.waitForTimeout(1700);
  ok('③ LCL は荷姿を先に出し、コンテナは出さない', (await R('#section-volume .cond-field--cargo-detail')).vis && !(await R('[data-field-id="container-type"]')).vis);
  await p.evaluate(() => window.setTransport('fcl')); await p.waitForTimeout(1700);
  // ⑤ 並び
  await p.evaluate(() => window.editorV2Go(5, true)); await p.waitForTimeout(300);
  const ta = await R('#remarkTextarea'), cs = await R('#remarkCargoSel'), ch = await R('#remarkChar'), pb = await R('#presetBtns');
  // Design 48（案B）：定型文は［＋ 定型文を入れる ▾］のパネル、品物別は右の列（steps-b-test.js）
  const rh = await R('#sbRmHead');
  ok('⑤ 見出し（＋ 定型文を入れる）→ 文章の欄 → 0文字・クリア の順', rh && rh.y < ta.y && ta.y < ch.y, { rh, ta, ch });
  if (!PHONE) ok('⑤ 「0文字・クリア」は欄の右下', Math.abs(ch.r - ta.r) <= 80, { ch, ta });
  if (!PHONE) {
    const nav = await R('#e2Nav'), sec = await R('#section-remark'), out = await R('#e2Out');
    ok('左右の端：［戻る］［次へ］を本文の幅にそろえる（出力する は右の列＝Design 48）', Math.abs(nav.x - sec.x) <= 2 && Math.abs(nav.r - sec.r) <= 2 && out.x > sec.r, { nav, sec, out });
  }

  // ===== 41：プレビュー／PDF 出力 =====
  await p.evaluate(() => window.editorV2Go(4, true)); await p.waitForTimeout(300);
  await p.evaluate(() => { const tr = document.querySelector('#tableBody tr:not([data-virtual]):not([data-type])'); const f = (n, v) => { const e = tr.querySelector(`[data-field="${n}"]`); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }; f('nm', '海上運賃'); f('sv', 'ONE'); f('un', '20GP'); f('pq', '2'); f('pp', '1000'); f('mk', '200'); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { window.openPreview(); const b = [...document.querySelectorAll('#pvWarnGuide button')].find(x => /このまま/.test(x.textContent)); if (b && !document.querySelector('#previewOverlay.open')) b.click(); });
  await p.waitForTimeout(900);
  ok('41-A：プレビュー中は合計バー・❓を出さない', !(await R('#e2Total')).vis && !((await R('#fbQuickFab')) || { vis: false }).vis);
  ok('41-B：プレビューは表計算だけ（見積書の切替を出さない）', await p.evaluate(() => !document.getElementById('previewBox').classList.contains('layout-doc') && !document.querySelector('.pv-layout-btn[data-pvl="doc"]').getClientRects().length));
  ok('41-C：見出しは「📋 プレビュー（表計算）」', await p.evaluate(() => document.querySelector('#previewBox .pv-main-title').textContent.trim() === '📋 プレビュー（表計算）'));
  const hg = await p.evaluate(() => [...document.querySelectorAll('#previewTable thead tr.pv-hgrp th')].map(t => t.textContent + ':' + t.colSpan));
  ok('41-E：見出しは 2 段（項目｜仕入｜請求｜結果）', JSON.stringify(hg) === JSON.stringify(['項目:3', '仕入:5', '請求:3', '結果:6']), hg);
  ok('41-E：カテゴリ未設定は空欄・CD の 0 は空欄', await p.evaluate(() => { const tr = document.querySelector('#previewTable tbody tr.pv-grp-row'); return !!tr && tr.cells[0].textContent.trim() === '' && tr.querySelector('.pv-cd').textContent.trim() === ''; }));
  const st = await p.evaluate(() => { const tr = document.querySelector('#previewTable tr.pv-subcon-subtotal'); if (!tr) return null; const cc = tr.querySelector('.pv-scs-costcol'), pr = tr.querySelector('td[data-ft-col="profit"]'), lc = tr.querySelector('.pv-scs-label .pv-scs-cost'); const cells = [...tr.cells].reduce((n, c) => n + (getComputedStyle(c).display === 'none' ? 0 : c.colSpan), 0); const head = [...document.querySelectorAll('#previewTable thead tr:not(.pv-hgrp) th')].filter(t => getComputedStyle(t).display !== 'none').length; return { cost: cc && cc.textContent, prof: pr && pr.textContent, inLabel: lc && getComputedStyle(lc).display, cells, head }; });
  ok('41-E：小計の仕入合計は「仕入」の列、粗利率は「利益」の列（ラベルの中には出さない）', st && /¥/.test(st.cost) && /粗利率/.test(st.prof) && st.inLabel === 'none', st);
  ok('41-E：小計行の列の数が見出しと合う', st && st.cells === st.head, st);
  await p.evaluate(() => document.querySelector('.pv-col-chk[data-col="pay"]').click()); await p.waitForTimeout(200);
  const st2 = await p.evaluate(() => { const tr = document.querySelector('#previewTable tr.pv-subcon-subtotal'); const lc = tr.querySelector('.pv-scs-label .pv-scs-cost'); const cells = [...tr.cells].reduce((n, c) => n + (getComputedStyle(c).display === 'none' ? 0 : c.colSpan), 0); const head = [...document.querySelectorAll('#previewTable thead tr:not(.pv-hgrp) th')].filter(t => getComputedStyle(t).display !== 'none').length; return { inLabel: getComputedStyle(lc).display, cells, head }; });
  ok('41-E：仕入の列を隠すと、仕入合計はラベルの中に戻る（列の数も合う）', st2.inLabel !== 'none' && st2.cells === st2.head, st2);
  await p.evaluate(() => document.querySelector('.pv-col-chk[data-col="pay"]').click()); await p.waitForTimeout(200);
  await p.evaluate(() => { const c = document.querySelector('.pv-col-chk[data-col="cat"]'); c.click(); });
  await p.waitForTimeout(200);
  ok('41-E：列を隠すと、見出しのまとまり（項目）の幅も合わせる', await p.evaluate(() => document.querySelector('#previewTable thead tr.pv-hgrp th.pv-hg-item').colSpan === 2));
  await p.evaluate(() => { const c = document.querySelector('.pv-col-chk[data-col="cat"]'); c.click(); });
  ok('41-I：右上は［PDF 出力］が主ボタン（右端の手前）・CSV の注記は消した', await p.evaluate(() => /PDF 出力/.test(document.querySelector('.pv-btn-pdf').textContent) && !/CSV はデータ行のみ/.test(document.getElementById('previewBox').textContent)));
  // 確認ガイドを出したまま PDF 出力を開く → 用紙の上の帯になる
  await p.evaluate(() => { window.preOutputValidationGate('テスト', () => {}); });
  await p.evaluate(() => document.querySelector('.pv-btn-pdf').click()); await p.waitForTimeout(800);
  ok('41-B：［PDF 出力］で PDF 出力（お客様向けの御見積書）の画面が開く', await p.evaluate(() => !!document.querySelector('#quoteDocOverlay.open')));
  ok('41-A：PDF 出力の画面でも合計バーを出さない', !(await R('#e2Total')).vis);
  const g = await p.evaluate(() => { const e = document.getElementById('pvWarnGuide'); if (!e || e.style.display === 'none') return null; const r = e.getBoundingClientRect(), s = document.querySelector('#quoteDocOverlay .qd-stage').getBoundingClientRect(); return { band: e.classList.contains('pv-wg-band'), inStage: r.left >= s.left - 1 && r.right <= s.right + 1 }; });
  ok('41-D：確認ガイドは用紙の上の帯（設定パネルに重ねない）', !g || (g.band && g.inStage), g);
  await p.evaluate(() => { const e = document.getElementById('pvWarnGuide'); if (e) e.style.display = 'none'; });
  const d = await p.evaluate(() => { const h = document.createElement('div'); h.innerHTML = buildQuoteDocHTML(); return { cat: /— カテゴリ —/.test(h.textContent), qty: [...h.querySelectorAll('.qd-items tbody tr td:nth-child(2)')].map(t => t.textContent.trim()).filter(Boolean), sc: h.querySelectorAll('tr.qd-subcon-head').length, one: /ONE/.test(h.querySelector('.qd-items').textContent), tax: /課税対象小計/.test(h.textContent) }; });
  ok('41-F：空のカテゴリ見出しを出さない', !d.cat, d);
  ok('41-F：数量は「2」（小数を付けない）', d.qty.includes('2') && !d.qty.some(q => /\.0000/.test(q)), d.qty);
  ok('41-F：サブコンの実名（ONE）は客先表示名が無いと出さない', d.sc === 0 && !d.one, d);
  ok('41-F：0 円の税の行（課税対象小計）は省く', !d.tax, d);
  const panel = await p.evaluate(() => { const ps = document.querySelector('#quoteDocOverlay .qd-panel'); const kids = [...ps.children].map(c => c.className); return { kids, secs: [...ps.querySelectorAll('.qd-sec-h')].map(x => x.textContent), why: !document.getElementById('qdMultiWhy').hidden }; });
  ok('41-G：［PDF 出力（印刷）］は設定の上（見出しの直後）', panel.kids[1] === 'qd-panel-foot' && panel.kids[2] === 'qd-panel-body', panel.kids);
  ok('41-G：設定は「よく使う設定」「そのほか」に分ける・併記が押せない理由を出す', JSON.stringify(panel.secs) === '["よく使う設定","そのほか"]' && panel.why, panel);
  if (PHONE) {
    const z = await p.evaluate(() => +(document.getElementById('qdPreview').style.zoom || 1));
    ok('41-H：スマホは御見積書を画面幅に縮める', z < 0.6, z);
    ok('41-H：スマホは設定を隠し、［⚙ 設定］で開く', !(await R('#quoteDocOverlay .qd-panel-body')).vis && (await R('#qdSetBtn')).vis);
    await p.click('#qdSetBtn'); await p.waitForTimeout(200);
    ok('41-H：［⚙ 設定］で設定のシートが開く', (await R('#quoteDocOverlay .qd-panel-body')).vis);
  }
  await p.evaluate(() => { document.getElementById('qdClose').click(); window.closePreview(); }); await p.waitForTimeout(300);
  ok('閉じると合計バーが戻る', (await R('#e2Total')).vis);
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件 FAIL` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
