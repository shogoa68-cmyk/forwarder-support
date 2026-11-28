// 用語の説明ドロワー（全画面共通・Design 35 案A2）と、❓カードの 2 行・列見出しの「ⓘ」の確認
//   node scripts/design-tests/help-glossary-test.js        （THEME=1 で Industry・W=390 でスマホ幅・OUT=<dir> で画像）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const W = +process.env.W || 1400, MOBILE = W <= 600;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const OUT = process.env.OUT;
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP', isMobile: MOBILE, hasTouch: MOBILE });
  await ctx.addInitScript(({ theme }) => {
    try { localStorage.setItem('fbFabHintDone_v1', '1'); } catch (e) {}
    try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: theme, doc: theme })); } catch (e) {}
    if (!theme) try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: false, doc: false })); } catch (e) {}
  }, { theme: !!process.env.THEME });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#fbQuickFab', { state: 'attached' });
  await p.waitForTimeout(600);
  const open = () => p.evaluate(() => { const d = document.getElementById('glossaryDrawer'); return !!d && !d.hidden; });
  const card = () => p.evaluate(() => { const c = document.getElementById('fbHelpCard'); return !!c && !c.hidden; });

  // ① ❓カード：1 行目・2 行目
  await p.evaluate(() => document.getElementById('fbQuickFab').click());
  ok('カードが開く', await card());
  const rows = await p.evaluate(() => Array.from(document.querySelectorAll('#fbHelpCard .fbhc-item')).map(e => e.textContent.trim()));
  ok('行の順：📖 用語を調べる／🧭 この画面の使い方／📘 マニュアル／🎓 AI トレーナー／🐞…', /^📖 用語を調べる/.test(rows[0]) && /^🧭 この画面の使い方/.test(rows[1]) && /マニュアル/.test(rows[2]) && /AI トレーナー/.test(rows[3]) && /🐞/.test(rows[4]) && rows.length >= 8, rows);
  const h = await p.evaluate(() => Array.from(document.querySelectorAll('#fbHelpCard .fbhc-item')).slice(0, 2).map(e => Math.round(e.getBoundingClientRect().height)));
  ok('行の高さ 44px 以上', h.every(x => x >= 44), h);

  // ② 見積入力以外（計算タブ）の画面から用語の説明が開く
  await p.evaluate(() => { document.getElementById('fbQuickFab').click(); });   // いったん閉じる
  await p.evaluate(() => { const b = document.querySelector('.cat-btn[aria-controls="tab-calc"], .cat-btn[onclick*="calc"]'); if (b) b.click(); });
  await p.waitForTimeout(300);
  const tabId = await p.evaluate(() => (document.querySelector('.tab-content.active') || {}).id);
  ok('見積入力以外の画面にいる', tabId && tabId !== 'tab-quote-make', tabId);
  await p.evaluate(() => document.getElementById('fbQuickFab').click());
  const useOff = await p.evaluate(() => document.getElementById('fbHelpUse').classList.contains('is-off'));
  const hasHelp = await p.evaluate(() => { const t = document.querySelector('.tab-content.active'); return !!t.querySelector('details.tab-help') || !!(window.manualForTab && window.manualForTab(t.id)); });
  ok('「この画面の使い方」はそのタブに説明（使い方またはマニュアルの章）があるときだけ有効', useOff === !hasHelp, { useOff, hasHelp });
  await p.evaluate(() => document.getElementById('fbHelpGloss').click());
  await p.waitForTimeout(200);
  ok('📖 を押すとカードが閉じてドロワーが開く', (await open()) && !(await card()));
  const st = await p.evaluate(() => { const d = document.getElementById('glossaryDrawer'), r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), vh: innerHeight, right: Math.round(r.right), vw: innerWidth, z: getComputedStyle(d).zIndex }; });
  if (MOBILE) ok('スマホは下から出るシート（高さ約 72vh・下端が画面の下）', Math.abs(st.h - st.vh * 0.72) < 8 && st.bottom === st.vh, st);
  else ok('PC は右から幅 430px', st.w === 430 && st.right === st.vw, st);
  const chips = await p.evaluate(() => Array.from(document.querySelectorAll('#glossaryDrawer .gl-groups button')).map(e => e.textContent + (e.classList.contains('is-on') ? '*' : '')));
  ok('チップは 7 つ・既定は「よく使う」', chips.length === 7 && chips[1] === 'よく使う*' && chips[0] === '全部', chips);
  const favN = await p.evaluate(() => document.querySelectorAll('#glossaryDrawer .gl-item').length);
  const favTerms = await p.evaluate(() => Array.from(document.querySelectorAll('#glossaryDrawer .gl-term')).map(e => e.textContent));
  ok('「よく使う」は 仕入＋乗せ幅＝売値／サブコン／R/T／FCL・LCL／POL・POD／THC', favN === 6 && /仕入/.test(favTerms[0]) && favTerms.some(t => /THC/.test(t)), favTerms);
  await p.evaluate(() => document.querySelector('#glossaryDrawer .gl-groups button[data-g="all"]').click());
  const allN = await p.evaluate(() => document.querySelectorAll('#glossaryDrawer .gl-item').length);
  ok('「全部」は全用語（25 件前後）', allN >= 24, allN);
  const cnt = {};
  for (const g of ['table', 'qty', 'party', 'charge', 'doc']) { await p.evaluate(g => document.querySelector(`#glossaryDrawer .gl-groups button[data-g="${g}"]`).click(), g); cnt[g] = await p.evaluate(() => document.querySelectorAll('#glossaryDrawer .gl-item').length); }
  ok('分類：見積の表の見方 7／数量 7／取引先 6／チャージ 3／書類 5 前後', cnt.table >= 7 && cnt.qty >= 6 && cnt.party >= 6 && cnt.charge >= 3 && cnt.doc >= 4, cnt);
  await p.evaluate(() => { const q = document.querySelector('#glossaryDrawer .gl-search'); q.value = 'NVOCC'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('検索：分類にかかわらず全体から見つかる', (await p.evaluate(() => document.querySelectorAll('#glossaryDrawer .gl-item').length)) >= 1);
  await p.evaluate(() => { const q = document.querySelector('#glossaryDrawer .gl-search'); q.value = 'ほげほげ'; q.dispatchEvent(new Event('input', { bubbles: true })); });
  const emp = await p.evaluate(() => { const e = document.querySelector('#glossaryDrawer .gl-empty'); return e ? e.textContent : ''; });
  ok('0 件：「ほげほげ」は見つかりませんでした＋追加してほしいボタン', /「ほげほげ」は見つかりませんでした/.test(emp) && /この用語を追加してほしい/.test(emp), emp);
  if (OUT) await p.screenshot({ path: OUT + `/glossary-${MOBILE ? 'sp' : 'pc'}-empty.png` });
  await p.evaluate(() => document.querySelector('#glossaryDrawer .gl-empty-btn').click());
  await p.waitForTimeout(400);
  ok('ボタンでご意見（アイデア）の入力が開き、検索語が入る', await p.evaluate(() => { const o = document.getElementById('fbOverlay'); const t = document.getElementById('fbTitle'); return !!o && o.classList.contains('open') && /ほげほげ/.test(t.value); }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await p.evaluate(() => { const o = document.getElementById('fbOverlay'); if (o && o.classList.contains('open') && window.closeFeedback) window.closeFeedback(); });

  // ③ 閉じ方：Esc／外側／✕／❓1 行目をもう一度／画面切替／📌
  const reopen = async () => { await p.evaluate(() => { if (!document.getElementById('glossaryDrawer') || document.getElementById('glossaryDrawer').hidden) window.openQuoteGlossary(); }); await p.waitForTimeout(80); };
  await reopen(); ok('開いた', await open());
  await p.keyboard.press('Escape'); await p.waitForTimeout(80); ok('Esc で閉じる', !(await open()));
  await reopen(); await p.evaluate(() => document.querySelector('#glossaryDrawer .gl-close').click()); ok('✕ で閉じる', !(await open()));
  await reopen(); await p.mouse.click(W > 600 ? 200 : 40, 120); await p.waitForTimeout(80); ok('外側を押すと閉じる', !(await open()));
  await reopen(); await p.evaluate(() => document.getElementById('fbQuickFab').click()); await p.evaluate(() => document.getElementById('fbHelpGloss').click()); await p.waitForTimeout(80);
  ok('❓の 1 行目をもう一度押すと閉じる', !(await open()));
  await reopen(); await p.evaluate(() => { const b = document.querySelector('.cat-btn[aria-controls="tab-quote-make"]'); b.click(); }); await p.waitForTimeout(300);
  ok('画面（タブ）を切り替えると閉じる', !(await open()));
  await reopen(); await p.evaluate(() => document.querySelector('#glossaryDrawer .gl-pin').click());
  ok('📌 固定の状態になる', await p.evaluate(() => document.querySelector('#glossaryDrawer .gl-pin').getAttribute('aria-pressed') === 'true'));
  await p.evaluate(() => { const b = document.querySelector('.cat-btn[aria-controls="tab-calc"], .cat-btn[onclick*="calc"]'); if (b) b.click(); }); await p.waitForTimeout(300);
  ok('📌 固定ならタブを切り替えても残る', await open());
  await p.evaluate(() => document.querySelector('#glossaryDrawer .gl-pin').click()); await p.evaluate(() => window.closeQuoteGlossary());

  // ④ 見積入力の列見出しの「ⓘ」
  await p.evaluate(() => { const b = document.querySelector('.cat-btn[aria-controls="tab-quote-make"]'); b.click(); });
  await p.waitForTimeout(500);
  const tryTable = await p.evaluate(() => { const i = document.querySelectorAll('#quoteTable th .hint-i'); return i.length; });
  ok('明細テーブルの見出しに「ⓘ」が 2 つ（単価・課税）', tryTable === 2, tryTable);
  const thW = await p.evaluate(() => Array.from(document.querySelectorAll('#quoteTable thead th')).map(t => t.id || t.className));
  ok('「ⓘ」は見出しの title を消さない', await p.evaluate(() => Array.from(document.querySelectorAll('#quoteTable th')).filter(t => t.querySelector('.hint-i')).every(t => !!t.getAttribute('title'))));
  await p.evaluate(() => document.querySelector('#quoteTable th .hint-i[data-hint="price"]').click());
  const pop = await p.evaluate(() => { const e = document.getElementById('hintI'); return e && !e.hidden ? e.textContent : ''; });
  ok('ⓘ を押すと説明が出る（仕・＋・売＋［📖 用語の説明を開く］［閉じる］）', /仕＝仕入/.test(pop) && /乗せ幅/.test(pop) && /売値/.test(pop) && /用語の説明を開く/.test(pop) && /閉じる/.test(pop), pop);
  await p.evaluate(() => document.querySelector('#hintI .hp-gl').click()); await p.waitForTimeout(150);
  ok('［📖 用語の説明を開く］でドロワーが「仕入」を検索した状態で開く', (await open()) && (await p.evaluate(() => document.querySelector('#glossaryDrawer .gl-search').value)) === '仕入' && (await p.evaluate(() => document.querySelectorAll('#glossaryDrawer .gl-item').length)) >= 1);
  await p.evaluate(() => window.closeQuoteGlossary());
  await p.evaluate(() => document.querySelector('#quoteTable th .hint-i[data-hint="tax"]').click());
  ok('課税の説明も出る・［閉じる］で閉じる', /消費税/.test(await p.evaluate(() => document.getElementById('hintI').textContent)));
  await p.evaluate(() => document.querySelector('#hintI .hp-close').click());
  ok('［閉じる］で説明が消える', await p.evaluate(() => document.getElementById('hintI').hidden));
  ok('ページが横にはみ出さない', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
