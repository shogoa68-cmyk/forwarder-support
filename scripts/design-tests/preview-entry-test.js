// 「📋 プレビュー」は見積書の画面を直接開く／社内チェック表はその画面から。架空データ・外部接続なし。
//   node scripts/design-tests/preview-entry-test.js   （THEME=1 で Industry・EDITOR=v2 で新画面・W=390 でスマホ幅）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const q = process.env.EDITOR === 'v2' ? '?editor=v2' : '';
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html${q}`;
  const W = +(process.env.W || 1400);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
  await p.evaluate(() => {
    const id = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').id.replace('row-', '');
    const set = (f, v) => { const el = document.getElementById(f + '-' + id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('nm', 'OCEAN FREIGHT'); set('pq', '1'); set('un', 'BL'); set('pp', '1000'); set('mk', '200');
  });
  await p.waitForTimeout(400);
  const st = () => p.evaluate(() => ({
    doc: !!document.querySelector('#quoteDocOverlay.open'),
    pv: !!document.querySelector('#previewOverlay.open'),
    guide: !!document.querySelector('#pvWarnGuide.open, #pvWarnGuide[style*="block"]'),
  }));
  // 確認ガイドが出たら「このまま出力」で進む
  const pass = () => p.evaluate(() => { const b = [...document.querySelectorAll('#pvWarnGuide button')].find(x => /このまま/.test(x.textContent)); if (b) b.click(); });
  await p.evaluate(() => document.querySelector('#quoteActionDock .qad-preview').click());
  await p.waitForTimeout(600); await pass(); await p.waitForTimeout(600);
  let s = await st();
  ok('［プレビュー］で見積書の画面が直接開く（表計算は開かない）', s.doc && !s.pv, s);
  const btns = await p.evaluate(() => ['qdMail', 'qdExcel', 'qdCheck'].map(i => !!document.getElementById(i)));
  ok('見積書の画面に［メール本文］［Excel］［社内チェック表］がある', btns.every(Boolean), btns);
  if (W > 600) {
    const vis = await p.evaluate(() => { const r = document.getElementById('qdCheck').getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    ok('［社内チェック表］が見えている', vis, vis);
  }
  await p.evaluate(() => document.getElementById('qdCheck').click()); await p.waitForTimeout(800);
  s = await st();
  ok('［社内チェック表］で表が開き、見積書の画面は閉じる', s.pv && !s.doc, s);
  ok('確認ガイドを出し直さない', !s.guide, s);
  const head = await p.evaluate(() => document.querySelector('#previewBox .pv-rail-head h2')?.textContent.trim());
  ok('表の題は「社内チェック表」', /社内チェック表/.test(head || ''), head);
  const back = await p.evaluate(() => { const b = document.querySelector('#previewBox [onclick="pvBackToDoc()"]'); return b ? b.textContent.trim() : null; });
  ok('表には［見積書に戻る］がある', /見積書に戻る/.test(back || ''), back);
  await p.evaluate(() => document.querySelector('#previewBox [onclick="pvBackToDoc()"]').click()); await p.waitForTimeout(700);
  s = await st();
  ok('［見積書に戻る］で見積書の画面へ（表は閉じる）', s.doc && !s.pv, s);
  await p.evaluate(() => document.getElementById('qdClose').click()); await p.waitForTimeout(400);
  s = await st();
  ok('閉じると両方とも閉じている', !s.doc && !s.pv, s);
  await p.keyboard.press('Control+p'); await p.waitForTimeout(600); await pass(); await p.waitForTimeout(600);
  s = await st();
  ok('Ctrl+P でも見積書の画面が開く', s.doc && !s.pv, s);
  ok('エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
