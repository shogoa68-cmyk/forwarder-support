// 新画面：左レールの固定表示（広い画面）・丸の数字は残す・右レール常時表示・下の合計バーの整理。  node scripts/design-tests/rail-dock-test.js （W=1600 既定・W=1300 で重ねる表示）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200); r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const W = +process.env.W || 1600;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('fwd.editorV2', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(900);
  const q = (fn) => p.evaluate(fn);
  const w = () => q(() => Math.round(document.getElementById('e2Steps').getBoundingClientRect().width));
  const wide = W >= 1400;
  if (wide) {
    ok('広い画面では、レールは最初から開いている（幅 200px）', (await w()) === 200);
    ok('固定表示：暗幕は出ない', await q(() => getComputedStyle(document.getElementById('e2Scrim')).display === 'none'));
    ok('固定表示：本文はレールの右にあり重ならない', await q(() => document.querySelector('#tab-quote-make .quote-workspace').getBoundingClientRect().left >= document.getElementById('e2Steps').getBoundingClientRect().right));
    await p.click('#e2Steps [data-e2s="2"]'); await p.waitForTimeout(400);
    ok('ステップを選んでも、レールは開いたまま', (await w()) === 200 && /2 ルート/.test(await q(() => document.getElementById('e2Head').textContent)));
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok('Esc ではしまわない（固定表示）', (await w()) === 200);
    await p.click('#e2Steps .e2-rail-toggle'); await p.waitForTimeout(300);
    ok('［«］でしまえる（56px）', (await w()) === 56);
    ok('しまった選択は覚える', await q(() => localStorage.getItem('fwd.e2Rail')) === '0');
    await p.reload(); await p.waitForTimeout(700); await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(900);
    ok('再読み込みしても、しまった状態から始まる', (await w()) === 56);
    await p.click('#e2Steps .e2-rail-toggle'); await p.waitForTimeout(300);
    ok('もう一度開ける', (await w()) === 200);
  } else {
    ok('狭い画面では、最初はしまっている（56px）', (await w()) === 56);
  }
  // 丸の中は常に数字
  ok('丸の中は数字のまま（✓／! に置き換えない）', await q(() => [...document.querySelectorAll('#e2Steps [data-e2s] i')].map(i => i.textContent.trim()).join(',') === '1,2,3,4,5'));
  await p.evaluate(() => { const i = document.getElementById('qf-customer'); i.value = 'テスト商事'; i.dispatchEvent(new Event('input', { bubbles: true })); const j = document.getElementById('qf-person'); if (j) { j.value = '田中'; j.dispatchEvent(new Event('input', { bubbles: true })); } });
  await p.waitForTimeout(500);
  const ok1 = await q(() => { const b = document.querySelector('#e2Steps [data-e2s="1"]'); const i = b.querySelector('i'); return { cls: b.className, txt: i.textContent.trim(), badge: getComputedStyle(i, '::after').content }; });
  ok('入力済みのステップは、数字のまま＋小さな✓の印', /is-ok/.test(ok1.cls) && ok1.txt === '1' && /✓/.test(ok1.badge), ok1);
  // 下の合計バー
  const btns = await q(() => [...document.querySelectorAll('#e2Total .e2t-btns button')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim()));
  ok('合計バーに［一時ファイル］［パターン登録］は無い', !btns.some(t => /一時ファイル|パターン登録/.test(t)), btns);
  if (wide && W >= 1500) {
    ok('1500px 以上では、右のレールが閉じていても縦の帯として出ている', await q(() => { const r = document.querySelector('#tab-quote-make .quote-right-col--rail'); return !!r && r.getBoundingClientRect().width > 40 && getComputedStyle(r).display !== 'none'; }));
    ok('その広い画面では、合計バーの［数量登録］［費用の内訳］［参考］は出さない', btns.length === 0, btns);
    await p.evaluate(() => document.querySelector('#qrcRail .qrc-rail-btn[data-mod="digest"]').click()); await p.waitForTimeout(500);
    ok('右のレールのボタンを押すと、引き出しが開く', await q(() => { const d = document.getElementById('qrcDrawer'); return d && getComputedStyle(d).display !== 'none' && d.getBoundingClientRect().width > 200; }));
  } else {
    ok('1500px 未満では、合計バーに［数量登録］［費用の内訳］［参考］が残る', btns.some(t => /数量登録/.test(t)) && btns.some(t => /費用の内訳/.test(t)), btns);
  }
  ok('JS エラーなし', errs.length === 0, errs);
  console.log('\nFAIL=' + fails); await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
