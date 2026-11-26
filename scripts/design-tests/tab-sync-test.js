// 複数のブラウザのタブ：見積は 1 つのタブだけ／ほかの画面は新しいタブで開ける（js/tab-sync.js）
//   node scripts/design-tests/tab-sync-test.js   （THEME=classic／EDITOR=v2 でも）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const th = process.env.THEME, ed = process.env.EDITOR;
  const q = [th ? 'theme=' + th : '', ed ? 'editor=' + ed : ''].filter(Boolean).join('&');
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html${q ? '?' + q : ''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fbFabHintDone_v1', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const errs = [];
  const open = async (u) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e))); await p.goto(u || URL); await p.waitForTimeout(900); return p; };
  const inEditor = p => p.evaluate(() => !document.getElementById('tab-quote-make').classList.contains('qp-dash'));
  const A = await open(), B = await open();
  await A.evaluate(() => window.qpNewQuote()); await A.waitForTimeout(400);
  ok('タブ A で新しい見積を開ける（A が見積の持ち主）', await inEditor(A) && await A.evaluate(() => window.qtOwn.isOwner()));
  // B でも見積を開こうとすると止まる
  await B.evaluate(() => window.qpShowDashboard && window.qpShowDashboard());
  await B.evaluate(() => window.qpNewQuote()); await B.waitForTimeout(1000);
  const m1 = await B.evaluate(() => { const m = document.getElementById('qtOwnModal'); return m ? { t: m.querySelector('h3').textContent, err: !m.querySelector('.qto-err').hidden } : null; });
  ok('タブ B：「見積は別のタブで開いています」が出て、見積は開かない', !!m1 && /別のタブ/.test(m1.t) && !m1.err && !(await inEditor(B)), m1);
  await B.click('#qtOwnModal .qto-cancel'); await B.waitForTimeout(150);
  ok('「やめる」で閉じる（B は見積を開いていない）', await B.evaluate(() => !document.getElementById('qtOwnModal')) && !(await inEditor(B)));
  // このタブへ移す（A に未保存なし）
  await A.fill('#qf-customer', ''); await A.evaluate(() => { window.cloudMarkDirty && 0; });
  await B.evaluate(() => window.qpNewQuote()); await B.waitForTimeout(1000);
  await B.click('#qtOwnModal .qto-move'); await B.waitForTimeout(1200);
  ok('「このタブへ移す」：B が見積を開き、A はダッシュボードに戻る', await inEditor(B) && !(await inEditor(A)) && await B.evaluate(() => window.qtOwn.isOwner()) && !(await A.evaluate(() => window.qtOwn.isOwner())));
  // B に未保存の変更があるときは移せない
  await B.evaluate(() => { const e = document.getElementById('qf-customer'); e.value = 'テスト商事'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await B.waitForTimeout(300);
  await A.evaluate(() => window.qpNewQuote()); await A.waitForTimeout(1000);
  const m2 = await A.evaluate(() => { const m = document.getElementById('qtOwnModal'); return m ? !m.querySelector('.qto-err').hidden : null; });
  ok('B に未保存の変更があると、A に「保存していない変更があります」', m2 === true, m2);
  await A.click('#qtOwnModal .qto-move'); await A.waitForTimeout(1900);
  ok('移そうとしても、未保存があるあいだは移らない（B のまま）', await inEditor(B) && !(await inEditor(A)) && await A.evaluate(() => !!document.getElementById('qtOwnModal')));
  await A.click('#qtOwnModal .qto-cancel');
  // B を閉じると、A で開ける
  await B.close({ runBeforeUnload: false }); await A.waitForTimeout(300);
  await A.evaluate(() => window.qpNewQuote()); await A.waitForTimeout(1100);
  ok('見積を開いていたタブを閉じると、ほかのタブで開ける（確認なし）', await inEditor(A) && await A.evaluate(() => !document.getElementById('qtOwnModal')));
  // 印だけ残っている（タブが落ちた）ときも開ける
  const C = await open();
  await A.close({ runBeforeUnload: false });
  await C.evaluate(() => localStorage.setItem('fwd.quoteOwner_v1', JSON.stringify({ id: 'ghost', at: Date.now() })));
  await C.evaluate(() => window.qpNewQuote()); await C.waitForTimeout(1100);
  ok('持ち主のタブが応えないとき（落ちたなど）は、確認なしで開ける', await inEditor(C) && await C.evaluate(() => !document.getElementById('qtOwnModal') && JSON.parse(localStorage.getItem('fwd.quoteOwner_v1')).id === window.qtOwn.id));
  // ② 画面ごとのアドレス
  const D = await open(URL + '#view=stats');
  ok('#view=stats で開くと「実績を見る」から始まる', await D.evaluate(() => document.getElementById('tab-stats').classList.contains('active')));
  await D.evaluate(() => document.querySelector('.cat-btn[aria-controls="tab-bookmark"]').click()); await D.waitForTimeout(300);
  const h = await D.evaluate(() => ({ hash: location.hash, title: document.title }));
  ok('画面を切り替えるとアドレスが #view=bookmark に変わり、タブの名前にも画面名が入る', h.hash === '#view=bookmark' && /–/.test(h.title), h);
  // Ctrl＋クリックで新しいタブ
  const before = await D.evaluate(() => document.querySelector('.tab-content.active').id);
  const [np] = await Promise.all([ctx.waitForEvent('page'), D.evaluate(() => { const b = document.querySelector('.cat-btn[aria-controls="tab-stats"]'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })); })]);
  await np.waitForLoadState(); await np.waitForTimeout(900);
  ok('Ctrl＋クリック：新しいタブでその画面が開き、元のタブはそのまま', /#view=stats$/.test(np.url()) && await np.evaluate(() => document.getElementById('tab-stats').classList.contains('active')) && (await D.evaluate(() => document.querySelector('.tab-content.active').id)) === before, { url: np.url(), before });
  await np.close();
  // 右クリックのメニュー
  await D.evaluate(() => { const b = document.querySelector('.cat-btn[aria-controls="tab-stats"]'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 })); }); await D.waitForTimeout(150);
  const cm = await D.evaluate(() => [...document.querySelectorAll('#tabCtxMenu button')].map(x => x.textContent));
  ok('右クリック：「↗ 新しいタブで開く」「このタブで開く」', cm.length === 2 && /新しいタブ/.test(cm[0]), cm);
  const [np2] = await Promise.all([ctx.waitForEvent('page'), D.click('#tabCtxMenu [data-a="new"]')]);
  await np2.waitForLoadState();
  ok('右クリックの「新しいタブで開く」で開く', /#view=stats$/.test(np2.url()), np2.url());
  await np2.close();
  ok('ページのエラーなし', errs.length === 0, errs);
  console.log('FAIL=' + fails); await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
