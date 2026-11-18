// 見積入力の新画面（editor-v2）の「入力の流れ」の確認（新規・空の状態から）
//   node scripts/design-tests/editor-v2-flow-test.js   （THEME=classic で現行）
//   ① 着いた直後のステップに「!」を出さない（離れたあとから）
//   ② 費用は、空の初期行だけでは ✓ にならない（品名か金額が入って ✓）
//   ③ 最後のステップの［次へ］は行き止まりにせず、プレビューへ進める
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const th = process.env.THEME;
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=v2` + (th ? `&theme=${th}` : '');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => { const l = document.querySelector('.qpd-local-link, [onclick*="qpd-local"], .qpd-local-start'); if (l) l.click(); else if (window.qpNewQuote) window.qpNewQuote(); }); await p.waitForTimeout(1500);
  const mark = n => p.evaluate(n => { const b = document.querySelector('#e2Steps [data-e2s="' + n + '"] i'); return b ? b.textContent.trim() : null; }, n);
  const fill = (id, v) => p.evaluate(([i, t]) => { const e = document.getElementById(i); e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  ok('新画面が有効で、ステップが 5 つ', await p.evaluate(() => document.documentElement.classList.contains('editor-v2') && document.querySelectorAll('#e2Steps [data-e2s]').length === 5));

  // ① 着いた直後は「!」を出さない
  ok('① ステップ1に着いた直後は「!」でなく番号（必須が空でも）', (await mark(1)) === '1', await mark(1));
  await p.click('#e2Next'); await p.waitForTimeout(400);
  ok('① 離れたあとのステップ1には「!」が出る（必須が空のまま）', (await mark(1)) === '!', await mark(1));
  ok('① 着いたばかりのステップ2には「!」を出さない', (await mark(2)) === '2', await mark(2));
  await p.click('#e2Next'); await p.waitForTimeout(400);
  ok('① ステップ2を離れると「!」が出る（POL/POD が空）', (await mark(2)) === '!', await mark(2));

  // ② 空の初期行だけでは費用を ✓ にしない
  await p.click('#e2Steps [data-e2s="4"]'); await p.waitForTimeout(500);
  ok('② 空の初期行だけのとき、費用は ✓ でなく番号（入力なし）', (await mark(4)) === '4', await mark(4));
  ok('② 要約は「未入力」', /未入力/.test(await p.textContent('#e2Head')), await p.textContent('#e2Head'));
  await p.evaluate(() => { const r = document.querySelector('#tableBody tr:not([data-virtual]) [data-field="nm"]'); r.value = '海上運賃'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(500);
  ok('② 品名が入ると ✓ になり、要約に行数が出る', (await mark(4)) === '✓' && /1行/.test(await p.textContent('#e2Head')), [await mark(4), await p.textContent('#e2Head')]);

  // ④ ［次へ］は、本文が長くても常に画面内（合計バーの上）に出る
  const nextInView = () => p.evaluate(() => { const n = document.getElementById('e2Next').getBoundingClientRect(), t = document.getElementById('e2Total').getBoundingClientRect(); return { top: Math.round(n.top), bottom: Math.round(n.bottom), totTop: Math.round(t.top), vh: innerHeight, ok: n.top >= 0 && n.bottom <= t.top + 1 }; });
  for (const st of [1, 2, 3, 4]) {
    await p.evaluate(n => document.querySelector('#e2Steps [data-e2s="' + n + '"]').click(), st); await p.waitForTimeout(500);
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(200);
    const r = await nextInView();
    ok('④ ステップ' + st + '：スクロールしなくても［次へ］が画面内（合計バーに隠れない）', r.ok, r);
  }
  // ⑤ 合計バーの「数量登録」「パターン登録」は、物量・費用（③④）だけに出す
  const qBtns = () => p.evaluate(() => ['[data-e2q]', '[data-e2p]'].map(s => { const e = document.querySelector('#e2Total ' + s); return !!e && getComputedStyle(e).display !== 'none' && e.offsetWidth > 0; }));
  for (const [st, want] of [[1, false], [2, false], [3, true], [4, true], [5, false]]) {
    await p.evaluate(n => document.querySelector('#e2Steps [data-e2s="' + n + '"]').click(), st); await p.waitForTimeout(400);
    const v = await qBtns();
    ok('⑤ ステップ' + st + '：「数量登録」「パターン登録」は' + (want ? '出る' : '出ない'), v[0] === want && v[1] === want, v);
  }
  ok('⑤ 「費用の内訳」「参考」はどのステップでも出る', await p.evaluate(() => ['[data-e2d="digest"]', '[data-e2d="ref"]'].every(s => { const e = document.querySelector('#e2Total ' + s); return !!e && e.offsetWidth > 0; })));

  // ③ 最後のステップの［次へ］はプレビューへ
  await p.click('#e2Steps [data-e2s="5"]'); await p.waitForTimeout(500);
  const nx = await p.evaluate(() => { const n = document.getElementById('e2Next'); return { dis: n.disabled, text: n.textContent.trim() }; });
  ok('③ ステップ5の［次へ］は押せる（行き止まりにしない）', nx.dis === false, nx);
  ok('③ ラベルは「プレビューで確認 →」', /プレビューで確認/.test(nx.text), nx);
  await p.evaluate(() => { document.getElementById('e2Next').click(); }); await p.waitForTimeout(1200);
  ok('③ 押すとプレビュー（または出力前の確認）が開く', await p.evaluate(() => !!document.querySelector('#previewOverlay.open, #pvWarnGuide')));
  ok('③ ステップ1〜4の［次へ］は従来どおり次のステップ名', await (async () => { await p.evaluate(() => { const c = document.querySelector('#previewOverlay.open .pv-close, #previewOverlay.open [onclick*="closePreview"]'); c && c.click(); const g = document.querySelector('#pvWarnGuide'); g && g.remove(); }); await p.click('#e2Steps [data-e2s="3"]'); await p.waitForTimeout(400); return /次へ：費用/.test(await p.textContent('#e2Next')); })());

  console.log(errs.length ? 'ERR ' + errs.slice(0, 3).join(' | ') : 'JSエラーなし');
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
