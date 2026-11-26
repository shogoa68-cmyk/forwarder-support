// 御見積書の「前回提示分からの変更点」：変更＝橙・追加＝緑（テーマに左右されない）・文字つきの札。架空データ・外部接続なし。
//   node scripts/design-tests/revision-color-test.js   （THEME=1 で Industry・SHOT=ファイル名 で画面を保存）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); p.setDefaultTimeout(10000);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
  await p.evaluate(() => window.addRow()); await p.waitForTimeout(300);
  const ids = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(t => t.id.replace('row-', '')));
  const set = (id, f, v) => p.evaluate(([i, v]) => { const el = document.getElementById(i); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [f + '-' + id, String(v)]);
  await set(ids[0], 'nm', 'HANDLING CHARGE'); await set(ids[0], 'pq', '4'); await set(ids[0], 'pp', '3000');
  await set(ids[1], 'nm', 'CUSTOMS'); await set(ids[1], 'pq', '1'); await set(ids[1], 'pp', '5900');
  await p.evaluate(() => { document.getElementById('qf-revision-baseline').value = JSON.stringify(window.buildRevisionSnapshot()); });
  await set(ids[0], 'pp', '3500');
  await p.evaluate(() => window.addRow()); await p.waitForTimeout(300);
  const id3 = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].pop().id.replace('row-', ''));
  await set(id3, 'nm', 'LABEL'); await set(id3, 'pq', '2'); await set(id3, 'pp', '300');
  await p.waitForTimeout(300);
  await p.evaluate(() => window.openQuoteDoc()); await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const st = el => el ? getComputedStyle(el) : null;
    const chg = document.querySelector('#qdPreview tr.qd-row-changed td'), add = document.querySelector('#qdPreview tr.qd-row-added td');
    const mc = document.querySelector('#qdPreview .qd-rev-mark-chg'), ma = document.querySelector('#qdPreview .qd-rev-mark-add');
    return { chgBg: st(chg)?.backgroundColor, addBg: st(add)?.backgroundColor, chgBar: st(chg)?.boxShadow, mcText: mc?.textContent, maText: ma?.textContent, mcBg: st(mc)?.backgroundColor, maBg: st(ma)?.backgroundColor };
  });
  ok('変更の行は橙の薄い背景', r.chgBg === 'rgb(255, 244, 224)', r);
  ok('追加の行は緑の薄い背景', r.addBg === 'rgb(232, 246, 238)', r);
  ok('変更の行の左に太い橙の線', /180, 83, 9/.test(r.chgBar || ''), r);
  ok('品名の前に「✎ 変更」「＋ 追加」の札（文字つき）', /変更/.test(r.mcText || '') && /追加/.test(r.maText || ''), r);
  ok('札は塗りつぶし（橙・緑）', r.mcBg === 'rgb(180, 83, 9)' && r.maBg === 'rgb(30, 122, 74)', r);
  if (process.env.SHOT) await p.locator('#qdPreview').screenshot({ path: process.env.SHOT });
  ok('エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
