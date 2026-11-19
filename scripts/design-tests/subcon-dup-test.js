// サブコン別明細をまるごと複製（サブコン見出しの「📋 複製」）の確認
//   node scripts/design-tests/subcon-dup-test.js   （THEME=classic で現行・EDITOR=v2 で新画面）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const v2 = process.env.EDITOR === 'v2', th = process.env.THEME, W = +process.env.W || 1400;
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=${v2 ? 'v2' : 'v1'}${th ? '&theme=' + th : ''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('quoteRemarkSheetSeen_v1', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { try { window.qpNewQuote(); } catch (e) {} }); await p.waitForTimeout(1200);
  if (v2) { await p.evaluate(() => { const b = document.querySelector('[data-e2s="4"]'); b && b.click(); }); await p.waitForTimeout(500); }
  const vis = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden'; }, sel);
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr:not([data-virtual])')].filter(t => !t.dataset.type).map(t => {
    const g = f => t.querySelector(`[data-field="${f}"]`)?.value || '';
    return { sv: g('sv'), nm: g('nm'), pp: g('pp'), pq: g('pq'), pt: g('pt'), done: !!t.dataset.doneAt };
  }));
  const heads = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr.subcon-group-header')].map(t => t.dataset.svLabel));

  // 準備：A運輸に 3 行（パターン FCL案 2 行＋なし 1 行）、B海運に 1 行
  await p.evaluate(() => {
    const set = (id, f, v) => { const e = document.getElementById(`${f}-${id}`); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } };
    const first = [...document.querySelectorAll('#tableBody tr:not([data-virtual])')].filter(t => !t.dataset.type)[0].id.replace('row-', '');
    const data = [['A運輸', 'OCEAN FREIGHT', '1000', 'FCL案'], ['A運輸', 'THC', '300', 'FCL案'], ['A運輸', 'DOC FEE', '50', ''], ['B海運', 'TRUCKING', '800', '']];
    let id = first;
    data.forEach((d, i) => {
      if (i > 0) id = String(window.addRowAfter(id));
      set(id, 'sv', d[0]); set(id, 'nm', d[1]); set(id, 'pq', '1'); set(id, 'pp', d[2]); set(id, 'pt', d[3]);
    });
    window.renderSubconGroups();
  });
  await p.waitForTimeout(400);
  // A運輸の最初の行を入力完了にしておく（複製先には引き継がない）
  await p.evaluate(() => { const tr = [...document.querySelectorAll('#tableBody tr:not([data-virtual])')].find(t => t.querySelector('[data-field="nm"]')?.value === 'OCEAN FREIGHT'); tr.querySelector('.row-done-btn').click(); });
  // サブコン別の注記
  await p.evaluate(() => { const h = [...document.querySelectorAll('#tableBody tr.subcon-group-header')].find(h => h.dataset.svLabel === 'A運輸'); const i = h.querySelector('.subcon-remark-input'); i.value = '20日前ブッキング'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('準備：見出しが A運輸・B海運の 2 つ', JSON.stringify(await heads()) === JSON.stringify(['A運輸', 'B海運']), await heads());

  if (v2) {   // 新画面（Design 43 案B）は見出しの［⋯］の中
    await p.click('#tableBody tr.subcon-group-header .gb-more'); await p.waitForTimeout(150);
    const its = await p.$$eval('#gbMenu .gb-mi', a => a.map(x => x.textContent));
    ok('新画面：サブコン見出しの［⋯］に「このサブコンを複製」がある', its.some(t => /複製/.test(t)), its);
    await p.keyboard.press('Escape');
  } else ok('サブコン見出しに「📋 複製」ボタンがある（すぐ見える）', await vis('#tableBody tr.subcon-group-header .sv-hdr-dup'));
  await p.evaluate(() => [...document.querySelectorAll('#tableBody tr.subcon-group-header')].find(h => h.dataset.svLabel === 'A運輸').querySelector('.sv-hdr-dup').click());
  await p.waitForTimeout(200);
  ok('押すと複製先の名前を聞く吹き出しが出る（明細 3 行と書いてある）', await vis('#sfPop.sf-pop-dup .sf-pop-in') && /3 行/.test(await p.evaluate(() => document.getElementById('sfPop').textContent)));
  ok('初期値は「A運輸（コピー）」で全選択', await p.evaluate(() => { const i = document.querySelector('#sfPop .sf-pop-in'); return i.value === 'A運輸（コピー）' && i.selectionStart === 0 && i.selectionEnd === i.value.length; }));
  // 同じ名前は不可
  await p.fill('#sfPop .sf-pop-in', 'Ａ運輸'); await p.click('#sfPop .sf-pop-ok'); await p.waitForTimeout(200);
  ok('元と同じ名前（全角・半角の違いも同じ扱い）では複製しない・吹き出しは残る', await vis('#sfPop') && (await rows()).length === 4);
  await p.fill('#sfPop .sf-pop-in', 'C汽船'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  const r1 = await rows();
  ok('C汽船の枠ができ、明細 3 行が複製される（全部で 7 行）', r1.length === 7 && r1.filter(r => r.sv === 'C汽船').length === 3, r1);
  ok('見出しの並びは A運輸 → C汽船 → B海運（元の枠の直後）', JSON.stringify(await heads()) === JSON.stringify(['A運輸', 'C汽船', 'B海運']), await heads());
  const c = r1.filter(r => r.sv === 'C汽船');
  ok('品名・単価・数量・パターンも同じ', JSON.stringify(c.map(r => [r.nm, r.pp, r.pq, r.pt])) === JSON.stringify([['OCEAN FREIGHT', '1000', '1', 'FCL案'], ['THC', '300', '1', 'FCL案'], ['DOC FEE', '50', '1', '']]), c);
  ok('元の A運輸の明細はそのまま（3 行）', r1.filter(r => r.sv === 'A運輸').length === 3);
  ok('入力完了の記録は複製先に引き継がない', c.every(r => !r.done) && r1.find(r => r.sv === 'A運輸' && r.nm === 'OCEAN FREIGHT').done);
  ok('サブコンへの注記は複製先にも入る', await p.evaluate(() => [...document.querySelectorAll('#tableBody tr.subcon-group-header')].find(h => h.dataset.svLabel === 'C汽船')?.querySelector('.subcon-remark-input')?.value === '20日前ブッキング'));
  ok('C汽船の中にパターン FCL案 の見出しがある', await p.evaluate(() => [...document.querySelectorAll('#tableBody tr.subcon-subgroup-header')].some(h => h.dataset.svKey === 'c汽船' && h.dataset.ptKey === 'FCL案')));
  ok('吹き出しは閉じる', !(await vis('#sfPop')));
  // もう一度：初期値は（コピー）で、既にある名前とぶつからない
  await p.evaluate(() => window.openDupSubconGroup('a運輸', 'A運輸', document.body)); await p.waitForTimeout(150);
  await p.evaluate(() => { const i = document.querySelector('#sfPop .sf-pop-in'); i.value = 'A運輸（コピー）'; }); await p.click('#sfPop .sf-pop-ok'); await p.waitForTimeout(500);
  await p.evaluate(() => window.openDupSubconGroup('a運輸', 'A運輸', document.body)); await p.waitForTimeout(150);
  ok('（コピー）が既にあるときの初期値は「A運輸（コピー2）」', await p.evaluate(() => document.querySelector('#sfPop .sf-pop-in').value) === 'A運輸（コピー2）');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok('Esc で閉じる（何も増えない）', !(await vis('#sfPop')) && (await rows()).length === 10);
  // 既存の別のサブコン名を選ぶと、その枠に合流する
  await p.evaluate(() => window.duplicateSubconGroup('b海運', 'C汽船')); await p.waitForTimeout(500);
  const r2 = await rows();
  ok('既にある名前を選ぶと、その枠に明細が加わる', r2.filter(r => r.sv === 'C汽船').length === 4, r2);
  // 合計
  // 仕入：A運輸 1,350 ×3 枠（元・C汽船・A運輸（コピー））＋ B海運 800 ×2（元・C汽船へ合流）＝ 5,650
  const cost = await p.evaluate(() => (document.getElementById('tot-cost')?.textContent || '').replace(/[^0-9]/g, ''));
  ok('合計の仕入に複製分も入る（5,650）', cost === '5650', cost);
  ok('ページのエラーなし', !errs.length, errs);
  await b.close(); srv.close();
  console.log(fails ? `\n${fails} FAIL` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
