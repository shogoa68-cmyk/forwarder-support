// コンパクト表示（常に前面の小窓・Document Picture-in-Picture）の試験。
//   本物の PiP は自動操作できないため、requestWindow を「小さな別ウィンドウ（window.open）」に差し替えて、小窓の中身と
//   元の行への読み書きを確かめる。   node scripts/design-tests/pip-compact-test.js   （THEME=1 Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.removeItem('quotePipSize_v1'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);

  // 非対応のブラウザ：案内が出て、何も起きない
  await p.evaluate(() => { window.__toasts = []; window.quoteShowToast = m => window.__toasts.push(m); delete window.documentPictureInPicture; try { Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true }); } catch (e) {} });
  await p.evaluate(() => window.quotePipToggle()); await p.waitForTimeout(200);
  ok('未対応のブラウザでは、Chrome／Edge で使える旨の案内が出る', await p.evaluate(() => window.__toasts.some(t => /Chrome|Edge/.test(t))));

  // 入口のボタン
  ok('テーブル操作バーに「🪟 常に前面」ボタンがある', await p.evaluate(() => !!document.querySelector('.quote-cmdbar .cmdbar-pip-btn[data-pip-btn]')));
  ok('「⋯」メニューにも「常に前面」がある', await p.evaluate(() => !!document.querySelector('#tbMenuMore [data-pip-btn]')));

  // PiP を、別ウィンドウで代用
  await p.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: async o => { const w = window.open('', '_blank', `width=${o.width},height=${o.height}`); w.document.open(); w.document.write('<!doctype html><html><head></head><body></body></html>'); w.document.close(); return w; } } });
  });
  const set = (id, f, v) => p.evaluate(([id, f, v]) => { const el = document.querySelector(`#tableBody tr#row-${id} [data-field="${f}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, f, v]);
  const rowIds = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')].map(t => t.id.replace('row-', '')));
  const first = (await rowIds())[0];
  await set(first, 'nm', 'THC 20'); await set(first, 'sv', 'WAN HAI'); await set(first, 'un', "20'GP"); await set(first, 'pq', '1'); await set(first, 'pp', '36000');
  await p.waitForTimeout(300);
  const popupP = ctx.waitForEvent('page');
  await p.evaluate(() => window.quotePipToggle());
  const pop = await popupP; await pop.waitForLoadState().catch(() => {}); await pop.waitForTimeout(600);
  ok('小窓が開く', !!pop);
  const q = f => pop.evaluate(f);
  ok('小窓に明細が 1 行出る（品名・サブコン・数量・単位が元の行の値）', await q(() => { const r = document.querySelector('.row'); return !!r && r.querySelector('[data-bind="nm"]').value === 'THC 20' && r.querySelector('[data-bind="sv"]').value === 'WAN HAI' && r.querySelector('[data-bind="pq"]').value === '1' && r.querySelector('[data-bind="un"]').value === "20'GP" && r.querySelector('[data-bind="pp"]').value === '36000'; }));
  ok('ボタンは「表示中」になる', await p.evaluate(() => /表示中/.test(document.querySelector('.cmdbar-pip-btn').textContent) && document.querySelector('.cmdbar-pip-btn').classList.contains('is-on')));
  ok('合計（仕・売・粗利）が小窓の見出しに出る', await q(() => document.getElementById('pcSell').textContent.trim() !== '' && document.getElementById('pcCost').textContent.trim() !== ''));

  await pop.screenshot({ path: path.join(process.env.OUT || '/tmp', 'pip-compact.png') }).catch(() => {});
  // 小窓で入力 → 元の行へ
  await pop.fill('.row [data-bind="pp"]', '40000'); await pop.waitForTimeout(400);
  ok('小窓で仕入単価を打つと、元の行の欄に入る', await p.evaluate(id => document.querySelector(`#tableBody tr#row-${id} [data-field="pp"]`).value === '40000', first));
  ok('元の行の売単価・金額が再計算される（小窓の「単価」も更新）', await p.evaluate(id => { const v = document.querySelector(`#tableBody tr#row-${id} [data-field="bp"]`).value; return !!v && v !== '0'; }, first) && await q(() => /\d/.test(document.querySelector('[data-calc="bp"]').textContent)));
  await pop.fill('.row [data-bind="nm"]', 'SEAL'); await pop.fill('.row [data-bind="sv"]', 'KMTC'); await pop.waitForTimeout(300);
  ok('品名・サブコンも元の行へ入る', await p.evaluate(id => document.querySelector(`#tableBody tr#row-${id} [data-field="nm"]`).value === 'SEAL' && document.querySelector(`#tableBody tr#row-${id} [data-field="sv"]`).value === 'KMTC', first));

  // 元の画面で変えたら小窓へ
  await set(first, 'pq', '3'); await pop.waitForTimeout(1900);
  ok('元の画面で数量を変えると、小窓にも反映される', await q(() => document.querySelector('.row [data-bind="pq"]').value === '3'));

  // 行追加・削除
  await pop.click('#pcAdd'); await pop.waitForTimeout(700);
  ok('小窓の「＋ 行を追加」で行が増える（小窓・元の画面の両方）', (await rowIds()).length === 2 && await q(() => document.querySelectorAll('.row').length === 2));
  ok('増えた行の品名欄に焦点が移る', await q(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.bind === 'nm'));
  await pop.click('.row:nth-child(1) [data-act="add"]'); await pop.waitForTimeout(700);
  ok('行の「＋」で、その行の下に追加される（3 行）', (await rowIds()).length === 3 && await q(() => document.querySelectorAll('.row').length === 3));
  p.on('dialog', d => d.accept());
  await pop.click('.row:nth-child(3) [data-act="del"]'); await pop.waitForTimeout(900);
  ok('行の「🗑」で削除される（確認のあと 2 行）', (await rowIds()).length === 2 && await q(() => document.querySelectorAll('.row').length === 2));

  // 閉じる
  await pop.click('#pcClose').catch(() => {}); await p.waitForTimeout(600);
  ok('閉じると、ボタンは元の表示に戻る', await p.evaluate(() => !/表示中/.test(document.querySelector('.cmdbar-pip-btn').textContent)));
  ok('閉じたあと、画面を操作してもエラーにならない', await (async () => { await set(first, 'pq', '5'); await p.waitForTimeout(1800); return errs.length === 0; })(), errs);
  ok('ページエラーなし', errs.length === 0, errs);
  console.log(fails ? `\n${fails} 件 FAIL` : '\n全項目 PASS');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
