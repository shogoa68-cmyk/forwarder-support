// 「サブコンの枠を先につくり、その中へ明細を入れ子で入力する」流れの確認
//   node scripts/design-tests/subcon-frame-test.js   （THEME=classic で現行・EDITOR=v2 で新画面・W=390 でスマホ幅）
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
  const realRows = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr:not([data-virtual])')].filter(t => !t.dataset.type).map(t => ({ id: t.id, sv: t.querySelector('[data-field="sv"]')?.value || '', nm: t.querySelector('[data-field="nm"]')?.value || '' })));
  const heads = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr.subcon-group-header')].map(t => t.textContent));

  ok('サブコンがまだ無いとき、手順の案内（①枠をつくる→②明細）が出る', await vis('#sfHint'));
  if (v2) {
    ok('費用の操作バーの主ボタンが「＋ サブコンを追加」', await p.evaluate(() => /サブコンを追加/.test(document.querySelector('#e2CostBar .e2-primary')?.textContent || '')));
    ok('主ボタンの文字が背景と同じ色になっていない（空の箱に見えない）', await p.evaluate(() => { const b = document.querySelector('#e2CostBar .e2-primary'); const c = getComputedStyle(b); return c.color !== c.backgroundColor && c.backgroundColor !== 'rgb(255, 255, 255)'; }), await p.evaluate(() => { const c = getComputedStyle(document.querySelector('#e2CostBar .e2-primary')); return [c.color, c.backgroundColor]; }));
    ok('「＋ 行を追加」は操作バーから無くなった', await p.evaluate(() => ![...document.querySelectorAll('#e2CostBar button')].some(x => /行を追加/.test(x.textContent))));
  }
  const n0 = (await realRows()).length;
  await p.click('.sf-hint-btn'); await p.waitForTimeout(200);
  ok('「＋ サブコンを追加」で名前の入力欄が出る', await vis('#sfPop .sf-pop-in'));
  await p.click('#sfPop .sf-pop-ok'); await p.waitForTimeout(150);
  ok('名前が空のままでは追加されない（入力欄に残る）', await vis('#sfPop') && (await realRows()).length === n0);
  await p.fill('#sfPop .sf-pop-in', 'テスト運輸'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  let rows = await realRows();
  ok('サブコンの枠ができる（見出しが出る）', (await heads()).some(t => /テスト運輸/.test(t)), await heads());
  ok('最初から入っている空の行を使い回す（行は増えない）', rows.length === n0 && rows[0].sv === 'テスト運輸', rows);
  ok('入力欄の吹き出しは閉じる', !(await vis('#sfPop')));
  ok('サブコンの枠ができたら、手順の案内は消える', !(await vis('#sfHint')));
  if (W > 600) ok('カーソルが明細の品名欄に入る', await p.evaluate(() => document.activeElement?.dataset?.field === 'nm'));
  ok('見出しの追加ボタンが「＋ 明細を追加」', await p.evaluate(() => /明細を追加/.test(document.querySelector('#tableBody .subcon-group-add-btn')?.textContent || '')));
  // 2 つ目のサブコン
  await p.evaluate(() => window.openAddSubconFrame(document.body)); await p.waitForTimeout(150);
  await p.fill('#sfPop .sf-pop-in', 'もう一社'); await p.click('#sfPop .sf-pop-ok'); await p.waitForTimeout(400);
  rows = await realRows();
  ok('2 つ目のサブコンは新しい行として足される', rows.length === n0 + 1 && rows.some(r => r.sv === 'もう一社'), rows);
  ok('見出しが 2 つになる', (await heads()).length === 2, await heads());
  // 同名のサブコン → 既存の枠の末尾へ明細を足す
  await p.evaluate(() => window.addSubconFrame('テスト運輸')); await p.waitForTimeout(400);
  rows = await realRows();
  ok('同じ名前を入れると、その枠の中へ明細が増える（見出しは増えない）', rows.filter(r => r.sv === 'テスト運輸').length === 2 && (await heads()).length === 2, rows);
  // 枠の中の「＋ 明細を追加」
  await p.evaluate(() => document.querySelector('#tableBody .subcon-group-add-btn').click()); await p.waitForTimeout(400);
  ok('見出しの「＋ 明細を追加」で、その枠に明細が足される', (await realRows()).filter(r => r.sv === 'テスト運輸').length === 3);
  // サブコンを決めずに追加
  await p.evaluate(() => window.openAddSubconFrame(document.body)); await p.waitForTimeout(150);
  await p.click('#sfPop .sf-pop-none'); await p.waitForTimeout(400);
  ok('「サブコンを決めずに明細を追加」で、サブコン未設定の行が足される', (await realRows()).some(r => !r.sv));
  // Esc で閉じる
  await p.evaluate(() => window.openAddSubconFrame(document.body)); await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok('Esc で吹き出しが閉じる', !(await vis('#sfPop')));
  ok('エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
