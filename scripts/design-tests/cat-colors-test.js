// 見積もりテーブル：カテゴリごとの薄い色分け（css/cat-colors.css・js/quote/cat-colors.js）
//   node scripts/design-tests/cat-colors-test.js   （THEME=classic|quiet・EDITOR=v1・W=390・OUT=<dir> で写真）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const th = process.env.THEME, ed = process.env.EDITOR || 'v2', W = +(process.env.W || 1440), OUT = process.env.OUT;
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=${ed}${th ? '&theme=' + th : ''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fbFabHintDone_v1', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(700);
  if (ed === 'v2') await p.evaluate(() => window.editorV2Go(4, true));
  const CATS = ['domestic', 'export-local', 'ocean', 'air', 'surcharge', 'import-local', 'overseas', 'customs-export', 'customs-import', 'insurance', 'other'];
  await p.evaluate(cats => {
    cats.forEach((c, i) => { if (i) window.addRow(); const trs = [...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')]; const tr = trs[trs.length - 1]; const s = tr.querySelector('select.w-cat'); s.value = c; s.dispatchEvent(new Event('change', { bubbles: true })); const n = tr.querySelector('[data-field="nm"]'); n.value = '品目' + i; n.dispatchEvent(new Event('input', { bubbles: true })); });
    window.addRow();   // カテゴリなしの行
    const trs = [...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')]; const n = trs[trs.length - 1].querySelector('[data-field="nm"]'); n.value = 'カテゴリなし'; n.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => { const s = trs[trs.length - 1].querySelector('select.w-cat'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); }, 200);
  }, CATS);
  await p.waitForTimeout(900);
  // 行の見た目の色（新画面＝行・旧画面＝セル）
  const looks = await p.evaluate(() => [...document.querySelectorAll('#tableBody > tr[id^="row-"]:not([data-virtual]):not([data-type])')].map(tr => {
    const td = [...tr.children].find(x => x.getClientRects().length && x.tagName === 'TD' && !x.classList.contains('check-cell')) || tr.children[0];
    const bgT = getComputedStyle(tr).backgroundColor, bgD = getComputedStyle(td).backgroundColor;
    const bg = /rgba\(0, 0, 0, 0\)/.test(bgD) ? bgT : bgD;
    const first = tr.classList.contains('ca-row') ? tr : [...tr.children].find(x => x.tagName === 'TD');
    return { cat: tr.querySelector('select.w-cat').value, bg, bar: getComputedStyle(first).boxShadow };
  }));
  if (W > 600) {
    const withCat = looks.filter(x => x.cat);
    ok('カテゴリごとに行の色が違う（11 色）', new Set(withCat.map(x => x.bg)).size === withCat.length, looks);
    ok('どの色も薄い（白に近い・明るさ 215 以上）', withCat.every(x => { const m = x.bg.match(/\d+/g).map(Number); return m.slice(0, 3).every(v => v >= 215) && !(m[0] === 255 && m[1] === 255 && m[2] === 255); }), withCat.map(x => x.bg));
    ok('左端にカテゴリの色の線', withCat.every(x => /inset/.test(x.bar) && /4px/.test(x.bar)), withCat.map(x => x.bar));
    const none = looks.find(x => !x.cat);
    ok('カテゴリなしの行は色を付けない', none && !withCat.some(x => x.bar === none.bar) && !withCat.some(x => x.bg === none.bg), none);
    // カテゴリを変えると色も変わる
    const before = looks[0].bg;
    await p.evaluate(() => { const tr = document.querySelector('#tableBody > tr[id^="row-"]:not([data-virtual])'); const s = tr.querySelector('select.w-cat'); s.value = 'insurance'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(300);
    const after = await p.evaluate(() => { const tr = document.querySelector('#tableBody > tr[id^="row-"]:not([data-virtual])'); const td = [...tr.children].find(x => x.getClientRects().length && !x.classList.contains('check-cell')); const d = getComputedStyle(td).backgroundColor; return /rgba\(0, 0, 0, 0\)/.test(d) ? getComputedStyle(tr).backgroundColor : d; });
    ok('カテゴリを変えると行の色も変わる', after !== before && after === looks.find(x => x.cat === 'insurance').bg, { before, after });
    await p.evaluate(() => { const tr = document.querySelector('#tableBody > tr[id^="row-"]:not([data-virtual])'); const s = tr.querySelector('select.w-cat'); s.value = 'domestic'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(400);
    // 凡例
    const lg = await p.evaluate(() => { const e = document.getElementById('catLegend'); return e && { vis: !e.hidden && !!e.getClientRects().length, items: [...e.querySelectorAll('.cat-lg-i')].map(x => x.textContent.trim()), beforeTable: !!(e.compareDocumentPosition(document.getElementById('tableScrollWrap')) & 4) }; });
    if (ed === 'v1') ok('旧い画面：凡例は出さない（行にカテゴリの欄があるため）', lg && !lg.vis, lg); else ok('表の上にカテゴリの凡例（使っているものだけ・件数つき）', lg && lg.vis && lg.beforeTable && lg.items.length === 11 && lg.items.some(t => /海上運賃\s*1/.test(t)), lg);
    if (ed !== 'v1') ok('凡例の文字に絵文字は付けない', lg && lg.items.every(t => !/[\u{1F300}-\u{1FAFF}]/u.test(t)), lg && lg.items);
    // サブコン見出し（仮想行）は色を変えない
    ok('サブコン見出し（表示専用の行）には色を付けない', await p.evaluate(() => { const h = document.querySelector('#tableBody > tr.subcon-group-header'); const bs = h ? getComputedStyle(h).boxShadow : ''; return !h || !(/inset/.test(bs) && /4px/.test(bs)); }));
    if (ed === 'v2') {
      // 選んだ行は従来どおり選択の色
      const pk = await p.evaluate(() => { const tr = document.querySelector('#tableBody > tr.ca-row'); const c = tr.querySelector('.row-select-chk, input[type=checkbox]'); c.click(); return new Promise(r => setTimeout(() => { const v = { picked: tr.classList.contains('ca-picked'), bg: getComputedStyle(tr).backgroundColor }; c.click(); r(v); }, 250)); });
      ok('新画面：選んだ行は選択の色（カテゴリの色にしない）', !pk.picked || pk.bg !== looks[0].bg, pk);
    }
    // 明細が全部カテゴリなしになると凡例は消える
    await p.evaluate(() => document.querySelectorAll('#tableBody select.w-cat').forEach(s => { s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.waitForTimeout(400);
    ok('カテゴリを使っていなければ凡例は出さない', await p.evaluate(() => document.getElementById('catLegend').hidden));
    await p.evaluate(cats => document.querySelectorAll('#tableBody > tr[id^="row-"]:not([data-virtual]) select.w-cat').forEach((s, i) => { if (cats[i]) { s.value = cats[i]; s.dispatchEvent(new Event('change', { bubbles: true })); } }), CATS);
    await p.waitForTimeout(400);
    if (OUT) { await p.evaluate(() => document.getElementById('tableScrollWrap').scrollIntoView({ block: 'start' })); await p.evaluate(() => window.scrollBy(0, -160)); await p.waitForTimeout(200); await p.screenshot({ path: path.join(OUT, `cat-${ed}-${th || 'industry'}.png`) }); }
  } else {
    await p.waitForTimeout(400);
    const mc = await p.evaluate(() => [...document.querySelectorAll('.mc-row[data-row]')].filter(x => x.getClientRects().length).map(x => ({ cat: x.dataset.cat || '', bg: getComputedStyle(x).backgroundColor, bar: getComputedStyle(x).boxShadow })));
    const wc = mc.filter(x => x.cat);
    ok('スマホ：一覧の行もカテゴリの色（行ごとに違う）', wc.length === 11 && !mc.find(x => !x.cat)?.bar?.includes("4px") && new Set(wc.map(x => x.bg)).size === 11, mc);
    ok('スマホ：左端に色の線', wc.every(x => (/inset/.test(x.bar) && /4px/.test(x.bar))), wc.map(x => x.bar));
    if (OUT) await p.screenshot({ path: path.join(OUT, `cat-phone-${th || 'industry'}.png`) });
  }
  ok('エラーなし', !errs.length, errs);
  await b.close(); srv.close();
  console.log(fails ? `FAIL=${fails}` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
