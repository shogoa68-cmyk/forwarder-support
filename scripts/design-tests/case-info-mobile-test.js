// 管理番号入力：Design 回答（2026-11）の小さな直しの試験（見出し下の帯・付箋のスマホ表示・日付の要約・自動バッジ・説明文）。
//   node scripts/design-tests/case-info-mobile-test.js   （OUT=<dir> で画像, MODE=simple, THEME=1）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  async function open(W) {
    const ctx = await b.newContext({ viewport: { width: W, height: 800 }, locale: 'ja-JP' });
    await ctx.addInitScript((mode) => { try { localStorage.setItem('fwd.uiMode', mode); } catch (e) {} }, process.env.MODE || 'detail');
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
    await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(700);
    return { ctx, p, errs };
  }
  const box = (p, s) => p.evaluate(x => { const e = document.querySelector(x); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, vis: r.width > 0 && r.height > 0 }; }, s);
  // PC
  { const { ctx, p, errs } = await open(1400);
    ok('[PC] 見出し下の空の帯はない（高さ 0）', (await p.evaluate(() => document.getElementById('qfCopiedFromInfo').getBoundingClientRect().height)) === 0);
    ok('[PC] 説明文「＊ が付いた3つが必須です」', (await p.textContent('.ci-first .ci-head')).includes('＊ が付いた3つが必須です'));
    ok('[PC] 日付の要約は出さない・日付欄が見える', !(await box(p, '#ciDatesSum')).vis && (await box(p, '#qf-date')).vis);
    ok('[PC] 自動バッジ：新規は出ている', await p.evaluate(() => !document.getElementById('ciAutoRecv').hidden && !document.getElementById('ciAutoDate').hidden));
    await p.click('#qf-received'); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(150);
    await p.focus('#qf-received'); await p.keyboard.type('11012026'); await p.focus('#qf-date'); await p.keyboard.type('11022026'); await p.waitForTimeout(200);
    ok('[PC] 値を変えると自動バッジが消える', await p.evaluate(() => document.getElementById('ciAutoRecv').hidden && document.getElementById('ciAutoDate').hidden));
    ok('[PC] メモが空なら点なし', !(await p.evaluate(() => document.getElementById('ciMemoBtn').classList.contains('has-memo'))));
    await p.evaluate(() => { const m = document.getElementById('qf-memo'); m.value = 'テスト案件'; m.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(150);
    ok('[PC] メモが入ると点が付く', await p.evaluate(() => document.getElementById('ciMemoBtn').classList.contains('has-memo')));
    ok('[PC] JS エラーなし', errs.length === 0, errs); await ctx.close(); }
  // スマホ
  { const { ctx, p, errs } = await open(390);
    const s = await box(p, '#ciDatesSum');
    ok('[スマホ] 日付は 1 行の要約に畳まれる', s.vis && !(await box(p, '#qf-date')).vis, s);
    const t = await p.textContent('#ciDatesSum'); ok('[スマホ] 要約に発行日と有効期限（標準）', /発行 \d\d\/\d\d・有効期限 \d\d\/\d\d（標準）/.test(t), t);
    await p.click('#ciDatesSum'); ok('[スマホ] 押すと 2 つの日付欄が開く', (await box(p, '#qf-date')).vis && (await box(p, '#qf-valid-until')).vis);
    await p.click('#ciDatesSum'); ok('[スマホ] もう一度押すと畳む', !(await box(p, '#qf-date')).vis);
    ok('[スマホ] 必須 3 項目は先頭（要約より上）', (await box(p, '#qf-ref')).t < s.t && (await box(p, '#qf-customer')).t < s.t && (await box(p, '#qf-person')).t < s.t);
    ok('[スマホ] 「📝 社内メモ」ボタンが案件名の行にあり、画面内に収まる', await p.evaluate(() => { const r = document.getElementById('ciMemoBtn').getBoundingClientRect(); return r.right <= innerWidth && r.width > 0; }));
    ok('[スマホ] 管理番号入力は画面幅に収まる', (await box(p, '#section-ref')).r <= 391, await box(p, '#section-ref'));
    ok('[スマホ] JS エラーなし', errs.length === 0, errs);
    if (process.env.OUT) { await p.evaluate(() => document.getElementById('section-ref').scrollIntoView()); await p.screenshot({ path: path.join(process.env.OUT, 'case-info-mobile.png') }); }
    await ctx.close(); }
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
