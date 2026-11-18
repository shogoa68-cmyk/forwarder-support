// 付箋（案件名・社内メモ）が、新画面のステップを切り替えても・セクションを畳んでも出たままになる確認
//   node scripts/design-tests/memo-float-steps-test.js   （THEME=classic で現行・EDITOR=v1 で旧画面・W=390 でスマホ幅）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const v2 = process.env.EDITOR !== 'v1', th = process.env.THEME, W = +(process.env.W || 1400), mobile = W <= 600;
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=${v2 ? 'v2' : 'v1'}${th ? '&theme=' + th : ''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP', hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('quoteRemarkSheetSeen_v1', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { try { window.qpNewQuote(); } catch (e) {} }); await p.waitForTimeout(1200);
  const vis = s => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; }, s);
  ok('付箋は見積タブの直下にある（セクションの中ではない）', await p.evaluate(() => document.getElementById('qfMemoFloat').parentElement.id === 'tab-quote-make'));
  ok('最初は出ていない', !(await vis('#qfMemoFloat')));
  await p.evaluate(() => window.toggleMemoFloat()); await p.waitForTimeout(300);
  ok('付箋ボタン（toggleMemoFloat）で開く', await vis('#qfMemoFloat'));
  await p.evaluate(() => { const t = document.getElementById('qf-memo-float-ta'); t.value = '案件名テスト\n申し送り'; t.dispatchEvent(new Event('input', { bubbles: true })); });   // 画面の入力は memo-title.js の見た目の編集欄。値の保持役の textarea へ入れる await p.waitForTimeout(200);
  if (v2) {
    for (const n of [2, 3, 4, 5, 1]) {
      await p.evaluate(n => { const b = document.querySelector('[data-e2s="' + n + '"]'); b && b.click(); }, n); await p.waitForTimeout(500);
      ok(`[新画面] ステップ ${n} に移っても付箋が出たまま・書いた内容も残る`, await vis('#qfMemoFloat') && (await p.inputValue('#qf-memo-float-ta')).startsWith('案件名テスト'));
    }
  } else {
    await p.evaluate(() => { window.toggleQuoteSection && window.toggleQuoteSection('section-ref'); }); await p.waitForTimeout(400);
    ok('[旧画面] 管理番号入力を畳んでも付箋は出たまま', await vis('#qfMemoFloat'));
  }
  ok('付箋に書いた内容が #qf-memo（保存される欄）へ反映される', (await p.inputValue('#qf-memo')).startsWith('案件名テスト'));
  await p.evaluate(() => document.getElementById('previewOverlay').classList.add('open')); await p.waitForTimeout(300);
  ok('プレビュー表示中は付箋が出ない', !(await vis('#qfMemoFloat')));
  await p.evaluate(() => document.getElementById('previewOverlay').classList.remove('open')); await p.waitForTimeout(300);
  ok('プレビューを閉じると付箋が戻る', await vis('#qfMemoFloat'));
  await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1200);
  ok('ダッシュボードでは出ない', !(await vis('#qfMemoFloat')));
  await p.evaluate(() => { const t = document.querySelector('[onclick*="bookmark"]'); t && t.click(); }); await p.waitForTimeout(500);
  ok('ほかのタブでも出ない', !(await vis('#qfMemoFloat')));
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(500);
  await p.evaluate(() => { try { window.qpNewQuote(); } catch (e) {} }); await p.waitForTimeout(1200);
  ok('新規の案件に切り替えると、開いたままの付箋の中身も空になる', (await p.inputValue('#qf-memo-float-ta')) === '' || !(await vis('#qfMemoFloat')), await p.inputValue('#qf-memo-float-ta'));
  ok('エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件失敗` : '\nすべて成功'); process.exit(fails ? 1 : 0);
})();
